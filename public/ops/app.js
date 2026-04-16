(function(){
'use strict';

// ─── Auth ─────────────────────────────────────────────
var ACCESS_CODE='2928'; // Last 4 of Jason's number
window.checkAuth=function(){
  var pin=document.getElementById('authPin').value;
  if(pin===ACCESS_CODE){
    document.getElementById('authGate').style.display='none';
    document.getElementById('mainApp').style.display='block';
    sessionStorage.setItem('hs-auth','1');
    initApp();
  } else {
    document.getElementById('authError').style.display='block';
    document.getElementById('authPin').value='';
  }
};
document.addEventListener('DOMContentLoaded',function(){
  if(sessionStorage.getItem('hs-auth')==='1'){
    document.getElementById('authGate').style.display='none';
    document.getElementById('mainApp').style.display='block';
    initApp();
  }
  document.getElementById('authPin').addEventListener('keydown',function(e){
    if(e.key==='Enter')checkAuth();
  });
});

// ─── State ────────────────────────────────────────────
var map,allReports=[],allAlerts=[],scoutZones=[],leads=[];
var layers={ref:null,mesh:null};
var layerState={ref:true,mesh:false};
var markers=[];
var demoCache={}; // demographics cache by state

// ─── Init ─────────────────────────────────────────────
function initApp(){
  initMap();
  initTabs();
  loadStorms();
  loadLeads();
  loadTemplates();
  // Auto-refresh every 3 minutes
  setInterval(loadStorms,3*60*1000);
  document.getElementById('stateFilter').addEventListener('change',function(){
    // Reset swath when changing state
    if(layerState.mesh){
      meshSwathLayers.forEach(function(l){map.removeLayer(l)});
      meshSwathLayers=[];
      layerState.mesh=false;
      document.getElementById('btnMesh').classList.remove('active');
    }
    loadStorms();
  });
  document.getElementById('searchInput').addEventListener('input',debounce(filterReports,300));
  // Set today's date in the date picker
  var today=new Date().toISOString().split('T')[0];
  document.getElementById('historyDate').value=today;
}

// ─── Map ──────────────────────────────────────────────
function initMap(){
  map=L.map('map',{
    zoomControl:true,attributionControl:false,
    dragging:true,touchZoom:true,scrollWheelZoom:false, // prevent accidental scroll hijack
    tap:true,minZoom:4,maxZoom:18
  }).setView([38.5,-92.5],7); // Zoomed into Missouri by default

  // Clean bright map — OpenStreetMap standard with full detail
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19
  }).addTo(map);

  // Radar — NEXRAD base reflectivity (verified working)
  layers.ref=L.tileLayer.wms('https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi',{
    layers:'nexrad-n0q-900913',transparent:true,format:'image/png',opacity:0.55
  }).addTo(map);

  // MESH swath — built from SPC spotter reports
  // We draw approximate hail paths by connecting nearby reports in time order
  // This creates a visual swath similar to MESH radar products
  layers.mesh=null; // Generated from report data, not a tile layer
}

var meshSwathLayers=[];

window.toggleLayer=function(id){
  layerState[id]=!layerState[id];
  var btn=document.getElementById(id==='ref'?'btnRef':'btnMesh');

  if(id==='ref'){
    try{
      if(layerState.ref) layers.ref.addTo(map);
      else map.removeLayer(layers.ref);
    }catch(e){}
  }

  if(id==='mesh'){
    if(layerState.mesh){
      loadMESHData();
    } else {
      meshSwathLayers.forEach(function(l){map.removeLayer(l)});
      meshSwathLayers=[];
      // Bring dots back
      markers.forEach(function(m){m.addTo(map)});
    }
  }

  if(btn) btn.classList.toggle('active',layerState[id]);
};

// ─── HailStrike Swath Engine v3 ───────────────────────
function loadMESHData(){
  meshSwathLayers.forEach(function(l){map.removeLayer(l)});
  meshSwathLayers=[];

  // Hide dot markers
  markers.forEach(function(m){map.removeLayer(m)});
  document.getElementById('statusText').textContent='Building swaths...';

  // Try to get NHI radar hail data first, merge with SPC reports
  var stations=['KEAX','KLSX','KSGF'];
  var fetches=stations.map(function(st){
    return fetch('/api/nexrad?action=hail&station='+st).then(function(r){return r.json()}).catch(function(){return{hailCells:[]}});
  });

  Promise.all(fetches).then(function(results){
    // Merge NHI cells with SPC reports for best coverage
    var allPoints=allReports.slice();

    results.forEach(function(data){
      (data.hailCells||[]).forEach(function(cell){
        if(cell.lat&&cell.lon&&cell.mehs&&cell.mehs>0){
          allPoints.push({
            lat:cell.lat,lon:cell.lon,
            size:cell.mehs,
            sizeLabel:cell.mehs>=2.75?'Baseball':cell.mehs>=1.75?'Golf Ball':cell.mehs>=1?'Quarter':'Small',
            location:'Radar Detection',county:'',state:'',
            time:cell.scanKey?cell.scanKey.split('_').slice(-3,-1).join(''):'',
            source:'NHI',poh:cell.poh,posh:cell.posh
          });
        }
      });
    });

    if(!allPoints.length){
      document.getElementById('statusText').textContent='No hail data available';
      markers.forEach(function(m){m.addTo(map)});
      return;
    }

    // Build tracks and paint swaths
    var tracks=buildTracks(allPoints);
    tracks.forEach(function(t){paintSwath(t)});
    document.getElementById('statusText').textContent=tracks.length+' storm swath'+(tracks.length!==1?'s':'')+' from '+allPoints.length+' data points (SPC + radar)';
  }).catch(function(){
    // Fallback to SPC only
    if(!allReports.length){
      document.getElementById('statusText').textContent='No data';
      return;
    }
    var tracks=buildTracks(allReports);
    tracks.forEach(function(t){paintSwath(t)});
    document.getElementById('statusText').textContent=tracks.length+' swaths from SPC reports';
  });
}

// Build storm tracks using NWS warning motion vectors + SPC report timing
// Supercells move SW→NE. We follow that bearing and only link reports
// that are downwind of each other in time order.
function buildTracks(reports){
  if(!reports.length) return [];

  var pts=reports.slice().sort(function(a,b){
    // Sort by time primarily
    var ta=(a.time||'0000');var tb=(b.time||'0000');
    if(ta!==tb) return ta.localeCompare(tb);
    // Same time — sort by latitude (south to north, storm motion)
    return a.lat-b.lat;
  });

  var used=[];for(var i=0;i<pts.length;i++)used[i]=false;
  var tracks=[];

  // Typical storm motion: SW to NE (~40-60° bearing)
  // Storms move at roughly 30-50 mph = 50-80 km/hr
  var typicalBearing=45; // degrees (NE)
  var bearingTolerance=60; // allow 60° deviation from typical
  var maxDistKm=80; // max distance between consecutive reports
  var maxTimeDiffMin=120; // max 2 hours between consecutive reports

  for(var i=0;i<pts.length;i++){
    if(used[i])continue;
    var track=[pts[i]];used[i]=true;
    var lastIdx=i;

    // Walk forward in time looking for the next report along this storm's path
    for(var j=i+1;j<pts.length;j++){
      if(used[j])continue;

      var last=pts[lastIdx];
      var candidate=pts[j];

      // Check distance
      var d=distKm(last.lat,last.lon,candidate.lat,candidate.lon);
      if(d>maxDistKm||d<1) continue; // too far or same spot

      // Check bearing — must be roughly NE of previous point
      var b=bear(last.lat,last.lon,candidate.lat,candidate.lon);
      var bDiff=Math.abs(b-typicalBearing);
      if(bDiff>180)bDiff=360-bDiff;
      if(bDiff>bearingTolerance) continue; // wrong direction

      // Check time difference
      var t1=parseInt(last.time||'0');var t2=parseInt(candidate.time||'0');
      var timeDiff=Math.abs(t2-t1);
      // Handle day wraparound
      if(timeDiff>1200) timeDiff=2400-timeDiff;
      // Convert HHMM diff to minutes roughly
      var minDiff=Math.floor(timeDiff/100)*60+(timeDiff%100);
      if(minDiff>maxTimeDiffMin) continue;

      // This report fits the storm track
      track.push(candidate);
      used[j]=true;
      lastIdx=j;
    }

    tracks.push(track);
  }

  // Merge very short tracks that are near each other and same direction
  // (sometimes one storm produces scattered single reports)
  var merged=[];
  var mergedUsed=[];for(var i=0;i<tracks.length;i++)mergedUsed[i]=false;

  for(var i=0;i<tracks.length;i++){
    if(mergedUsed[i])continue;
    var t=tracks[i].slice();
    mergedUsed[i]=true;

    if(t.length<=2){
      // Try to attach to a nearby longer track
      for(var j=0;j<tracks.length;j++){
        if(mergedUsed[j]||j===i)continue;
        var lastOfJ=tracks[j][tracks[j].length-1];
        var firstOfT=t[0];
        var d=distKm(lastOfJ.lat,lastOfJ.lon,firstOfT.lat,firstOfT.lon);
        if(d<40){
          var b2=bear(lastOfJ.lat,lastOfJ.lon,firstOfT.lat,firstOfT.lon);
          var bDiff2=Math.abs(b2-typicalBearing);
          if(bDiff2>180)bDiff2=360-bDiff2;
          if(bDiff2<bearingTolerance){
            tracks[j]=tracks[j].concat(t);
            mergedUsed[i]=true;
            break;
          }
        }
      }
    }
    if(!mergedUsed[i]||t.length>2) merged.push(t);
  }

  return merged.length?merged:tracks.filter(function(t){return t.length>0});
}

// Paint one storm swath — smooth elongated ellipses like RadarScope
function paintSwath(track){
  if(!track.length)return;

  // For each report point, draw overlapping elongated ellipses
  // They blend together into a smooth flowing swath along the storm path
  for(var i=0;i<track.length;i++){
    var r=track[i];

    // Determine storm bearing at this point
    var stormBearing=45; // default NE
    if(track.length>1){
      if(i<track.length-1) stormBearing=bear(r.lat,r.lon,track[i+1].lat,track[i+1].lon);
      else stormBearing=bear(track[i-1].lat,track[i-1].lon,r.lat,r.lon);
    }

    // Ellipse size based on hail magnitude
    var majorKm=r.size>=2.75?14:r.size>=1.75?10:r.size>=1?7:5; // along storm
    var minorKm=r.size>=2.75?6:r.size>=1.75?4.5:r.size>=1?3:2.5; // perpendicular

    // Draw 3 concentric ellipses for gradient effect
    var layers=[
      {majMult:1.6,minMult:1.6,color:'#fff176',opacity:0.08}, // outer yellow
      {majMult:1.0,minMult:1.0,color:r.size>=2?'#ff7043':'#ffa726',opacity:0.14}, // mid orange
      {majMult:0.5,minMult:0.5,color:r.size>=2.5?'#e53935':'#f4511e',opacity:0.22} // inner red
    ];

    layers.forEach(function(layer){
      var pts=buildEllipse(
        r.lat,r.lon,
        majorKm*layer.majMult,
        minorKm*layer.minMult,
        stormBearing
      );
      var poly=L.polygon(pts,{
        fillColor:layer.color,fillOpacity:layer.opacity,
        color:layer.color,weight:0,smoothFactor:3
      });
      poly.addTo(map);meshSwathLayers.push(poly);
    });
  }
}

// Build an ellipse rotated along a bearing
function buildEllipse(lat,lon,majorKm,minorKm,bearingDeg){
  var pts=[];
  var steps=36; // smooth circle
  for(var i=0;i<steps;i++){
    var angle=(i/steps)*2*Math.PI;
    // Ellipse in local coords
    var dx=majorKm*Math.cos(angle);
    var dy=minorKm*Math.sin(angle);
    // Rotate by storm bearing
    var bRad=bearingDeg*Math.PI/180;
    var rx=dx*Math.cos(bRad)-dy*Math.sin(bRad);
    var ry=dx*Math.sin(bRad)+dy*Math.cos(bRad);
    // Convert km offset to lat/lon
    var newLat=lat+ry/111.32;
    var newLon=lon+rx/(111.32*Math.cos(lat*Math.PI/180));
    pts.push([newLat,newLon]);
  }
  return pts;
}

// ─── Geo helpers ──────────────────────────────────────
function distKm(a,b,c,d){var R=6371,p=Math.PI/180,x=(c-a)*p,y=(d-b)*p,z=Math.sin(x/2)*Math.sin(x/2)+Math.cos(a*p)*Math.cos(c*p)*Math.sin(y/2)*Math.sin(y/2);return R*2*Math.atan2(Math.sqrt(z),Math.sqrt(1-z))}
function bear(a,b,c,d){var p=Math.PI/180,y=Math.sin((d-b)*p)*Math.cos(c*p),x=Math.cos(a*p)*Math.sin(c*p)-Math.sin(a*p)*Math.cos(c*p)*Math.cos((d-b)*p);return(Math.atan2(y,x)/p+360)%360}
function offset(lat,lon,brng,km){var R=6371,p=Math.PI/180,b=brng*p,d=km/R,a=lat*p,o=lon*p,la=Math.asin(Math.sin(a)*Math.cos(d)+Math.cos(a)*Math.sin(d)*Math.cos(b)),lo=o+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(a),Math.cos(d)-Math.sin(a)*Math.sin(la));return[la/p,lo/p]};

// ─── Tabs ─────────────────────────────────────────────
function initTabs(){
  document.querySelectorAll('.tab').forEach(function(t){
    t.addEventListener('click',function(){
      document.querySelectorAll('.tab').forEach(function(b){b.classList.remove('active')});
      document.querySelectorAll('.tab-panel').forEach(function(p){p.classList.remove('active')});
      t.classList.add('active');
      document.getElementById('panel-'+t.dataset.tab).classList.add('active');
      if(t.dataset.tab==='map') setTimeout(function(){map.invalidateSize()},100);
      if(t.dataset.tab==='social') loadFacebook();
    });
  });
}

// ─── Warning Polygons on Map ─────────────────────────
var warningPolygons=[];
function loadWarningPolygons(){
  // Fetch active warnings with geometry from NWS
  fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert&event=Severe%20Thunderstorm%20Warning,Tornado%20Warning',{
    headers:{'User-Agent':'HailStrikeOps/1.0','Accept':'application/geo+json'}
  }).then(function(r){return r.json()}).then(function(data){
    // Clear old polygons
    warningPolygons.forEach(function(p){map.removeLayer(p)});
    warningPolygons=[];

    (data.features||[]).forEach(function(f){
      if(!f.geometry||!f.geometry.coordinates) return;
      var evt=(f.properties.event||'').toLowerCase();
      var isTornado=evt.includes('tornado');
      var color=isTornado?'#ff0000':'#ffcc00';
      var fillColor=isTornado?'rgba(255,0,0,0.2)':'rgba(255,204,0,0.15)';
      var weight=isTornado?3:2;

      try{
        // GeoJSON coordinates are [lon,lat], Leaflet needs [lat,lon]
        var coords=f.geometry.coordinates;
        if(f.geometry.type==='Polygon'){
          var latLngs=coords[0].map(function(c){return[c[1],c[0]]});
          var poly=L.polygon(latLngs,{color:color,fillColor:fillColor,fillOpacity:1,weight:weight,dashArray:isTornado?'':'5,5'});
          poly.bindPopup('<b style="color:'+color+'">'+f.properties.event+'</b><br>'+
            '<span style="color:#999">'+(f.properties.areaDesc||'')+'</span><br>'+
            '<span style="font-size:11px;color:#888">'+(f.properties.headline||'').substring(0,200)+'</span>');
          poly.addTo(map);
          warningPolygons.push(poly);
        }
        if(f.geometry.type==='MultiPolygon'){
          coords.forEach(function(polyCoords){
            var latLngs=polyCoords[0].map(function(c){return[c[1],c[0]]});
            var poly=L.polygon(latLngs,{color:color,fillColor:fillColor,fillOpacity:1,weight:weight,dashArray:isTornado?'':'5,5'});
            poly.bindPopup('<b style="color:'+color+'">'+f.properties.event+'</b><br>'+
              '<span style="color:#999">'+(f.properties.areaDesc||'')+'</span>');
            poly.addTo(map);
            warningPolygons.push(poly);
          });
        }
      }catch(e){console.error('Polygon render error:',e)}
    });
  }).catch(function(e){console.error('Warning polygons fetch failed:',e)});
}

// ─── Load Storm Data ──────────────────────────────────
function loadStorms(){
  var state=document.getElementById('stateFilter').value;
  var url='/api/scout'+(state?'?state='+state:'');
  document.getElementById('statusText').textContent='Fetching...';

  fetch(url).then(function(r){return r.json()}).then(function(data){
    allReports=data.hailReports||[];
    allAlerts=data.activeAlerts||[];
    scoutZones=data.scoutingZones||[];

    // Stats
    document.getElementById('sReports').textContent=data.summary.totalReports;
    document.getElementById('sMaxSize').textContent=data.summary.maxHailSize?data.summary.maxHailSize.toFixed(1)+'"':'0';
    document.getElementById('sZones').textContent=data.summary.scoutingZones;
    document.getElementById('sAlerts').textContent=data.summary.activeAlerts;
    document.getElementById('statusText').textContent='Live — '+new Date().toLocaleTimeString();

    renderMap(allReports);
    renderReports(allReports);
    renderScout(scoutZones,data.adTargeting);
    renderAlerts(allAlerts);
    loadWarningPolygons();
  }).catch(function(e){
    console.error(e);
    document.getElementById('statusText').textContent='Error — retrying...';
    setTimeout(loadStorms,10000);
  });
}

// ─── Fetch demographics for a state ───────────────────
function fetchDemographics(state){
  if(demoCache[state]) return Promise.resolve(demoCache[state]);
  return fetch('/api/demographics?state='+state).then(function(r){return r.json()}).then(function(data){
    var byCounty={};
    (data.counties||[]).forEach(function(c){
      // Census returns "Howard County, Indiana" — extract county name
      var name=c.name.split(',')[0].replace(' County','').trim().toLowerCase();
      byCounty[name]=c;
    });
    var byPlace=data.placesByName||{};
    demoCache[state]={summary:data.summary,byCounty:byCounty,byPlace:byPlace};
    return demoCache[state];
  }).catch(function(){return null});
}

// ─── Load demographics for all states in reports ──────
function loadAllDemographics(reports){
  var states=[...new Set(reports.map(function(r){return r.state}))];
  return Promise.all(states.map(function(s){return fetchDemographics(s)}));
}

// ─── Get city data first, county as fallback ──────────
function getCityDemo(location,county,state){
  var d=demoCache[state];
  if(!d) return {data:null,level:'none'};
  // Try to extract city name from SPC location (e.g. "3 NW Trenton" → "trenton")
  var cityName=(location||'').replace(/^\d+\s+[NSEW]+\s+/i,'').replace(/^\d+\s+[NSEW]{2,3}\s+/i,'').trim().toLowerCase();
  if(d.byPlace&&d.byPlace[cityName]) return {data:d.byPlace[cityName],level:'city'};
  // Fallback to county
  var countyKey=county.toLowerCase().replace(' county','').trim();
  if(d.byCounty&&d.byCounty[countyKey]) return {data:d.byCounty[countyKey],level:'county'};
  return {data:null,level:'none'};
}

function getCountyDemo(county,state){
  var d=demoCache[state];
  if(!d) return null;
  var key=county.toLowerCase().replace(' county','').trim();
  return d.byCounty[key]||null;
}

// ─── Estimate vehicles/houses affected ────────────────
function estimateImpact(demo,size){
  if(!demo) return {vehicles:'N/A',houses:'N/A',income:'N/A',homeValue:'N/A',pop:'N/A'};
  // Rough estimate: hail swath covers ~5-15% of a county depending on size
  var coverage=size>=2.75?0.12:size>=1.75?0.08:size>=1?0.05:0.03;
  var affectedPop=Math.round(demo.population*coverage);
  // Avg 1.88 vehicles per household, avg 2.5 people per household
  var households=Math.round(affectedPop/2.5);
  var vehicles=Math.round(households*1.88);
  return {
    vehicles:vehicles.toLocaleString(),
    houses:households.toLocaleString(),
    income:'$'+((demo.medianIncome||0)/1000).toFixed(0)+'k',
    homeValue:'$'+((demo.medianHomeValue||0)/1000).toFixed(0)+'k',
    pop:affectedPop.toLocaleString(),
    totalPop:demo.population.toLocaleString(),
    totalHousing:(demo.totalHousingUnits||0).toLocaleString()
  };
}

// ─── Render Map Markers ───────────────────────────────
function renderMap(reports){
  markers.forEach(function(m){map.removeLayer(m)});
  markers=[];

  // Load demographics then render
  loadAllDemographics(reports).then(function(){
    reports.forEach(function(r){
      var color=r.size>=2.75?'#ff1744':r.size>=1.75?'#C0392B':r.size>=1?'#ffab00':'#00e5ff';
      var radius=r.size>=2.75?9:r.size>=1.75?7:r.size>=1?5:4;
      var m=L.circleMarker([r.lat,r.lon],{radius:radius,fillColor:color,fillOpacity:0.8,color:'#fff',weight:1.5,bubblingMouseEvents:false});
      if(r.size>=1.75) L.circleMarker([r.lat,r.lon],{radius:radius+5,fillColor:color,fillOpacity:0.12,stroke:false,interactive:false}).addTo(map);

      var cityInfo=getCityDemo(r.location,r.county,r.state);
      var demo=cityInfo.data;
      var demoLevel=cityInfo.level;

      // Convert UTC time to Central
      var localTime=utcToCentral(r.time);
      var demoLabel=demoLevel==='city'?'City Demographics (Census)':'County Demographics (Census)';
      var popLabel=demoLevel==='city'?'City Population':'County Population';

      var popup='<div style="min-width:220px">'+
        '<b style="font-size:14px">'+r.location+', '+r.state+'</b><br>'+
        '<div style="margin:6px 0;padding:6px 0;border-top:1px solid #2a2a3e;border-bottom:1px solid #2a2a3e">'+
          '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">Hail Size</span><b style="color:'+color+'">'+r.size+'" — '+r.sizeLabel+'</b></div>'+
          '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">County</span><b>'+r.county+'</b></div>'+
          '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">Time</span><b>'+localTime+' CT '+(r.day==='today'?'Today':'Yesterday')+'</b></div>'+
          '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">Source</span><b>NWS/SPC Verified</b></div>'+
          (isMediaVerified(r.comments)?'<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">Media</span><b style="color:#00e676">PHOTO/VIDEO CONFIRMED</b></div>':'')+
        '</div>'+
        '<div style="margin:6px 0;padding:6px 0;border-bottom:1px solid #2a2a3e">'+
          '<div style="font-size:10px;color:#C0392B;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700">'+demoLabel+'</div>'+
          (demo?
            '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">'+popLabel+'</span><b>'+(demo.population||0).toLocaleString()+'</b></div>'+
            '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">Median Income</span><b>$'+((demo.medianIncome||0)/1000).toFixed(0)+'k</b></div>'+
            '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">Median Home Value</span><b>$'+((demo.medianHomeValue||0)/1000).toFixed(0)+'k</b></div>'+
            '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">Housing Units</span><b>'+(demo.totalHousingUnits||0).toLocaleString()+'</b></div>'
          :'<div style="color:#6a6a8a;font-size:11px">Demographics loading...</div>')+
        '</div>'+
        (r.comments?'<div style="font-style:italic;color:#888;font-size:11px;margin:4px 0">'+r.comments+'</div>':'')+
        '<button class="card-btn red" style="margin-top:6px;width:100%" onclick="addLeadFromMap(\''+r.location+'\',\''+r.county+'\',\''+r.state+'\')">+ ADD LEAD</button>'+
      '</div>';

      m.bindPopup(popup,{maxWidth:300});
      m.addTo(map);
      markers.push(m);
    });
    if(markers.length) fitAllMarkers();
  });
}

// ─── Render Reports List ──────────────────────────────
function renderReports(reports){
  var el=document.getElementById('reportsList');
  if(!reports.length){el.innerHTML='<div class="data-card"><div class="card-title" style="color:var(--muted)">No hail reports for this filter</div></div>';return}
  // Prioritize EAX (Kansas City NWS — Jason's territory) reports first, then by size
  var sorted=reports.slice().sort(function(a,b){
    var aHome=isHomeTerritory(a.comments)?1:0;
    var bHome=isHomeTerritory(b.comments)?1:0;
    if(aHome!==bHome) return bHome-aHome; // Home territory first
    return b.size-a.size; // Then by size
  });
  el.innerHTML=sorted.slice(0,50).map(function(r){
    var bc=r.size>=2.75?'badge-hotred':r.size>=1.75?'badge-red':r.size>=1?'badge-amber':'badge-cyan';
    return '<div class="data-card" onclick="flyTo('+r.lat+','+r.lon+')">'+
      '<div class="card-head"><span class="card-title">'+r.location+', '+r.state+'</span><span class="card-badge '+bc+'">'+r.size+'" '+r.sizeLabel+'</span></div>'+
      '<div class="card-meta"><span>'+r.county+' Co.</span><span>'+utcToCentral(r.time)+' CT '+(r.day==='today'?'Today':'Yest.')+'</span><span>'+r.damageLevel+'</span>'+
      (isMediaVerified(r.comments)?'<span class="card-badge badge-green" style="font-family:var(--font);font-size:9px">MEDIA VERIFIED</span>':'')+
      (isHomeTerritory(r.comments)?'<span class="card-badge badge-red" style="font-family:var(--font);font-size:9px">HOME ZONE</span>':'')+
      (getWFO(r.comments)?'<span style="color:#666;font-size:10px">NWS: '+getWFO(r.comments)+'</span>':'')+
      '</div>'+
      (r.comments?'<div class="card-meta" style="margin-top:4px"><span style="color:#888">'+r.comments+'</span></div>':'')+
    '</div>';
  }).join('');
}

// ─── Render Scouting Zones ────────────────────────────
function renderScout(zones,adData){
  var el=document.getElementById('scoutList');
  if(!zones.length){el.innerHTML='<div class="data-card"><div class="card-title" style="color:var(--muted)">No scouting zones — check back after storms</div></div>';return}
  var maxScore=zones[0].opportunityScore||1;
  el.innerHTML=zones.slice(0,20).map(function(z,i){
    var pct=Math.min(100,Math.round(z.opportunityScore/maxScore*100));
    var color=pct>=70?'var(--red)':pct>=40?'var(--amber)':'var(--cyan)';
    return '<div class="data-card" onclick="flyTo('+z.lat+','+z.lon+')">'+
      '<div class="card-head"><span class="card-title">#'+(i+1)+' '+z.county+' County, '+z.state+'</span><span class="card-badge badge-red">Score: '+z.opportunityScore+'</span></div>'+
      '<div class="card-meta"><span>Max: <b>'+z.maxSize+'"</b></span><span>Avg: <b>'+z.avgSize+'"</b></span><span><b>'+z.reportCount+'</b> reports</span><span>'+z.damageLevel+'</span></div>'+
      '<div class="score-bar"><div class="score-fill" style="width:'+pct+'%;background:'+color+'"></div></div>'+
      '<div class="card-actions"><button class="card-btn red" onclick="event.stopPropagation();addLeadFromZone(\''+z.county+'\',\''+z.state+'\')">+ Add Lead</button><button class="card-btn" onclick="event.stopPropagation();findBusinesses('+z.lat+','+z.lon+')">Find Shops</button><button class="card-btn" onclick="event.stopPropagation();copyAdTarget(\''+z.county+'\',\''+z.state+'\','+z.lat+','+z.lon+','+z.maxSize+')">Copy Ad Target</button></div>'+
    '</div>';
  }).join('');

  // Ad targeting
  var adEl=document.getElementById('adTargeting');
  if(adData&&adData.adCopy){
    adEl.innerHTML='<div class="data-card"><div class="card-title">Pre-Built Ad Copy</div>'+
      '<div class="card-meta" style="flex-direction:column;gap:6px;margin-top:8px">'+
      '<div><b>Headline 1:</b> '+adData.adCopy.headline1+'</div>'+
      '<div><b>Headline 2:</b> '+adData.adCopy.headline2+'</div>'+
      '<div><b>Body:</b> '+adData.adCopy.body1+'</div>'+
      '</div><div class="card-actions"><button class="card-btn" onclick="copyText(\''+adData.adCopy.headline1+'\')">Copy H1</button><button class="card-btn" onclick="copyText(\''+adData.adCopy.body1.replace(/'/g,"\\'")+'\')">Copy Body</button></div></div>';
  }
}

// ─── Render Alerts ────────────────────────────────────
function renderAlerts(alerts){
  var el=document.getElementById('alertsList');
  if(!alerts.length){el.innerHTML='<div class="data-card"><div class="card-title" style="color:var(--muted)">No active severe weather alerts</div></div>';return}
  el.innerHTML=alerts.map(function(a){
    var severe=a.severity==='Severe'||a.severity==='Extreme';
    var shareText=encodeURIComponent((a.headline||a.event)+' — Track live at missouri-dent-bully.vercel.app/ops/');
    return '<div class="data-card alert-card'+(severe?' severe':'')+'">'+
      '<div class="alert-event">'+a.event+(a.hailSize?' — '+a.hailSize+'" HAIL':'')+'</div>'+
      '<div class="alert-area">'+a.areas+'</div>'+
      '<div class="alert-desc">'+((a.description||'').substring(0,200))+'</div>'+
      '<div class="card-actions">'+
        '<a class="card-btn" href="https://twitter.com/intent/tweet?text='+shareText+'" target="_blank">X / Twitter</a>'+
        '<a class="card-btn" href="https://www.facebook.com/sharer/sharer.php?quote='+shareText+'" target="_blank">Facebook</a>'+
        '<a class="card-btn" href="sms:?body='+shareText+'">Text</a>'+
        '<a class="card-btn" href="mailto:?subject=Storm%20Alert&body='+shareText+'">Email</a>'+
        '<button class="card-btn" onclick="shareNative(\''+((a.headline||'').replace(/'/g,''))+'\')">Share</button>'+
      '</div></div>';
  }).join('');
}

// ─── Leads — 3 types ─────────────────────────────────
var currentLeadType='storm';
var stormLeads=[],customerLeads=[],dealershipLeads=[];

function loadLeads(){
  stormLeads=JSON.parse(localStorage.getItem('hs-storm-leads')||'[]');
  customerLeads=JSON.parse(localStorage.getItem('hs-customer-leads')||'[]');
  dealershipLeads=JSON.parse(localStorage.getItem('hs-dealer-leads')||'[]');
  renderAllLeads();
  // Filter chips
  document.querySelectorAll('.filter-chip').forEach(function(c){
    c.addEventListener('click',function(){
      var forType=c.dataset.for;
      document.querySelectorAll('.filter-chip[data-for="'+forType+'"]').forEach(function(b){b.classList.remove('active')});
      c.classList.add('active');
      renderLeadList(forType,c.dataset.lf);
    });
  });
}

window.switchLeadType=function(type){
  currentLeadType=type;
  document.querySelectorAll('.type-tab').forEach(function(t){t.classList.toggle('active',t.dataset.lt===type)});
  document.querySelectorAll('.lead-section').forEach(function(s){s.classList.remove('active')});
  document.getElementById('sec-'+type).classList.add('active');
  hideAddLead();
};

function renderAllLeads(){
  renderLeadList('storm','all');
  renderLeadList('customer','all');
  renderLeadList('dealership','all');
}

function renderLeadList(type,filter){
  filter=filter||'all';
  var arr=type==='storm'?stormLeads:type==='customer'?customerLeads:dealershipLeads;
  var filtered=filter==='all'?arr:arr.filter(function(l){return l.status===filter});
  var elId=type+'LeadsList';
  var el=document.getElementById(elId);
  if(!el) return;

  if(!filtered.length){
    var msg=type==='storm'?'No storm leads yet. Add from map or scout tab.':type==='customer'?'No customers yet. Add when someone calls or walks in.':'No dealership accounts yet.';
    el.innerHTML='<div class="data-card"><div class="card-title" style="color:var(--muted)">'+msg+'</div></div>';
    return;
  }

  el.innerHTML=filtered.map(function(l,i){
    var bc=getStatusBadge(l.status);
    var title=type==='dealership'?(l.dealerName||'Dealership #'+(i+1)):type==='storm'?(l.area||l.location||'Storm Zone #'+(i+1)):(l.name||'Customer #'+(i+1));
    var meta='';
    if(type==='storm') meta=(l.county?'<span>'+l.county+' Co, '+l.state+'</span>':'')+(l.hailSize?'<span>'+l.hailSize+'" hail</span>':'')+(l.stormEvent?'<span>'+l.stormEvent+'</span>':'');
    if(type==='customer') meta=(l.phone?'<span>'+l.phone+'</span>':'')+(l.vehicle?'<span>'+l.vehicle+'</span>':'')+(l.damageType?'<span>'+l.damageType+'</span>':'')+(l.source?'<span>via '+l.source+'</span>':'');
    if(type==='dealership') meta=(l.dealerContact?'<span>'+l.dealerContact+'</span>':'')+(l.dealerPhone?'<span>'+l.dealerPhone+'</span>':'')+(l.dealerType?'<span>'+l.dealerType+'</span>':'')+(l.lotSize?'<span>~'+l.lotSize+' vehicles</span>':'');

    var actions='';
    var phone=type==='dealership'?l.dealerPhone:l.phone;
    if(phone) actions+='<a class="card-btn red" href="tel:'+phone+'">Call</a><a class="card-btn" href="sms:'+phone+'">Text</a>';
    actions+='<button class="card-btn" onclick="nextStatus(\''+type+'\','+i+')">Next Status</button>';
    actions+='<button class="card-btn" onclick="deleteLead(\''+type+'\','+i+')" style="color:var(--red)">Delete</button>';

    return '<div class="data-card">'+
      '<div class="card-head"><span class="card-title">'+title+'</span><span class="card-badge '+bc+'">'+l.status+'</span></div>'+
      '<div class="card-meta">'+meta+'</div>'+
      (l.notes?'<div class="card-meta" style="margin-top:4px"><span style="color:#666">'+l.notes+'</span></div>':'')+
      '<div class="card-actions">'+actions+'</div></div>';
  }).join('');
}

function getStatusBadge(s){
  if(['new','scouted','prospecting'].indexOf(s)>=0) return 'badge-cyan';
  if(['contacted','door-knocked','pitched'].indexOf(s)>=0) return 'badge-amber';
  if(['estimate sent','contract sent'].indexOf(s)>=0) return 'badge-amber';
  if(['appointment booked','booked','active','scheduled'].indexOf(s)>=0) return 'badge-green';
  if(['completed','paid','renewal'].indexOf(s)>=0) return 'badge-green';
  if(['lost','insurance filed','in progress'].indexOf(s)>=0) return 'badge-red';
  return 'badge-cyan';
}

window.showAddLead=function(type){
  currentLeadType=type||currentLeadType;
  document.getElementById('addLeadForm').style.display='block';
  document.getElementById('stormFields').style.display=currentLeadType==='storm'?'block':'none';
  document.getElementById('customerFields').style.display=currentLeadType==='customer'?'block':'none';
  document.getElementById('dealershipFields').style.display=currentLeadType==='dealership'?'block':'none';
  var titles={storm:'New Storm Lead',customer:'New Customer',dealership:'New Dealership Account'};
  document.getElementById('formTitle').textContent=titles[currentLeadType]||'New Lead';
};
window.hideAddLead=function(){document.getElementById('addLeadForm').style.display='none'};

window.saveLead=function(){
  var l={status:'new',createdAt:new Date().toISOString()};
  if(currentLeadType==='storm'){
    l.type='storm';l.area=document.getElementById('lStormArea').value;
    l.county=document.getElementById('lStormCounty').value;l.state=document.getElementById('lStormState').value;
    l.stormEvent=document.getElementById('lStormEvent').value;l.damageType=document.getElementById('lStormDamage').value;
    l.hailSize=document.getElementById('lStormHailSize').value;l.notes=document.getElementById('lStormNotes').value;
    l.status='scouted';
    stormLeads.unshift(l);localStorage.setItem('hs-storm-leads',JSON.stringify(stormLeads));
  } else if(currentLeadType==='customer'){
    l.type='customer';l.name=document.getElementById('lName').value;l.phone=document.getElementById('lPhone').value;
    l.email=document.getElementById('lEmail').value;l.address=document.getElementById('lAddress').value;
    l.city=document.getElementById('lCity').value;l.state=document.getElementById('lState').value;
    l.vehicle=document.getElementById('lVehicle').value;l.damageType=document.getElementById('lDamage').value;
    l.source=document.getElementById('lSource').value;l.insurance=document.getElementById('lInsurance').value;
    l.notes=document.getElementById('lNotes').value;
    customerLeads.unshift(l);localStorage.setItem('hs-customer-leads',JSON.stringify(customerLeads));
  } else {
    l.type='dealership';l.dealerName=document.getElementById('lDealerName').value;
    l.dealerContact=document.getElementById('lDealerContact').value;l.dealerPhone=document.getElementById('lDealerPhone').value;
    l.dealerEmail=document.getElementById('lDealerEmail').value;l.dealerAddress=document.getElementById('lDealerAddress').value;
    l.dealerCity=document.getElementById('lDealerCity').value;l.dealerState=document.getElementById('lDealerState').value;
    l.lotSize=document.getElementById('lDealerLotSize').value;l.dealerType=document.getElementById('lDealerType').value;
    l.notes=document.getElementById('lDealerNotes').value;l.status='prospecting';
    dealershipLeads.unshift(l);localStorage.setItem('hs-dealer-leads',JSON.stringify(dealershipLeads));
  }
  renderAllLeads();hideAddLead();
  fetch('/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(l)}).catch(function(){});
};

window.addLeadFromMap=function(loc,county,state){
  stormLeads.unshift({type:'storm',area:loc,location:loc,county:county,state:state,damageType:'auto-hail',source:'storm-scout',status:'scouted',createdAt:new Date().toISOString()});
  localStorage.setItem('hs-storm-leads',JSON.stringify(stormLeads));
  renderAllLeads();map.closePopup();
};
window.addLeadFromZone=function(county,state){
  stormLeads.unshift({type:'storm',area:county+' County zone',county:county,state:state,damageType:'auto-hail',source:'storm-scout',status:'scouted',createdAt:new Date().toISOString()});
  localStorage.setItem('hs-storm-leads',JSON.stringify(stormLeads));
  renderAllLeads();
};

var statusOrders={
  storm:['scouted','door-knocked','contacted','estimate sent','booked','in progress','completed','lost'],
  customer:['new','contacted','estimate sent','appointment booked','insurance filed','in progress','completed','paid','lost'],
  dealership:['prospecting','pitched','contract sent','active','renewal','lost']
};
window.nextStatus=function(type,i){
  var arr=type==='storm'?stormLeads:type==='customer'?customerLeads:dealershipLeads;
  var order=statusOrders[type];
  var cur=order.indexOf(arr[i].status);
  arr[i].status=order[(cur+1)%order.length];
  var key=type==='storm'?'hs-storm-leads':type==='customer'?'hs-customer-leads':'hs-dealer-leads';
  localStorage.setItem(key,JSON.stringify(arr));
  renderLeadList(type);
};
window.deleteLead=function(type,i){
  if(!confirm('Delete this lead?')) return;
  var arr=type==='storm'?stormLeads:type==='customer'?customerLeads:dealershipLeads;
  arr.splice(i,1);
  var key=type==='storm'?'hs-storm-leads':type==='customer'?'hs-customer-leads':'hs-dealer-leads';
  localStorage.setItem(key,JSON.stringify(arr));
  renderLeadList(type);
};

// ─── Templates ────────────────────────────────────────
function loadTemplates(){
  fetch('/api/outreach').then(function(r){return r.json()}).then(function(data){
    var el=document.getElementById('templatesList');
    var sms=data.templates.sms;
    el.innerHTML=Object.keys(sms).map(function(k){
      var t=sms[k];
      return '<div class="data-card"><div class="card-title">'+t.name+'</div><div class="card-meta" style="margin-top:6px"><span style="color:#999;line-height:1.5">'+t.message+'</span></div><div class="card-actions"><button class="card-btn" onclick="copyText(\''+t.message.replace(/'/g,"\\'")+'\')">Copy</button></div></div>';
    }).join('');
    // Preview first template
    document.getElementById('blastPreview').value=sms.pdr_hail_initial.message;
    document.getElementById('blastTemplate').addEventListener('change',function(){
      var sel=this.value;
      if(sms[sel]) document.getElementById('blastPreview').value=sms[sel].message;
    });
  }).catch(function(){});
}
window.sendBlast=function(){alert('SMS blast requires Twilio integration. Add TWILIO_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE to Vercel env vars.')};

// ─── Facebook Integration ─────────────────────────────
var fbConnected=false;
var fbReplyRecipient='';

function loadFacebook(){
  fetch('/api/facebook').then(function(r){return r.json()}).then(function(data){
    fbConnected=data.configured;
    var el=document.getElementById('fbStatus');
    if(!data.configured){
      el.innerHTML='<div class="data-card" style="border-left:3px solid var(--amber)">'+
        '<div class="card-title" style="color:var(--amber)">Facebook Not Connected</div>'+
        '<div class="card-meta" style="flex-direction:column;gap:4px;margin-top:8px">'+
        '<span>1. Go to developers.facebook.com — create or use existing app</span>'+
        '<span>2. Add Pages API product</span>'+
        '<span>3. Generate Page Access Token with permissions</span>'+
        '<span>4. Add to Vercel env vars: FACEBOOK_PAGE_TOKEN, FACEBOOK_PAGE_ID</span>'+
        '</div></div>';
      document.getElementById('fbPostsList').innerHTML='';
      document.getElementById('fbMessagesList').innerHTML='';
      return;
    }
    el.innerHTML='<div class="data-card" style="border-left:3px solid var(--green)"><div class="card-title" style="color:var(--green)">Facebook Connected</div></div>';
    loadFBPosts();
    loadFBMessages();
  }).catch(function(){});
}

function loadFBPosts(){
  if(!fbConnected) return;
  fetch('/api/facebook?action=posts').then(function(r){return r.json()}).then(function(data){
    var el=document.getElementById('fbPostsList');
    var posts=data.posts||[];
    if(!posts.length){el.innerHTML='<div class="data-card"><div class="card-title" style="color:var(--muted)">No recent posts</div></div>';return}
    el.innerHTML=posts.map(function(p){
      var likes=p.likes&&p.likes.summary?p.likes.summary.total_count:0;
      var comments=p.comments&&p.comments.summary?p.comments.summary.total_count:0;
      var shares=p.shares?p.shares.count:0;
      var date=new Date(p.created_time).toLocaleDateString();
      return '<div class="data-card">'+
        '<div class="card-meta" style="margin-bottom:6px"><span>'+date+'</span><span>'+likes+' likes</span><span>'+comments+' comments</span><span>'+shares+' shares</span></div>'+
        '<div style="font-size:13px;color:var(--white);line-height:1.5">'+((p.message||'').substring(0,200))+'</div>'+
        '<div class="card-actions">'+
          (p.permalink_url?'<a class="card-btn" href="'+p.permalink_url+'" target="_blank">View</a>':'')+
          '<button class="card-btn" onclick="loadComments(\''+p.id+'\')">Comments</button>'+
        '</div></div>';
    }).join('');
  }).catch(function(){});
}

function loadFBMessages(){
  if(!fbConnected) return;
  fetch('/api/facebook?action=messages').then(function(r){return r.json()}).then(function(data){
    var el=document.getElementById('fbMessagesList');
    var convos=data.conversations||[];
    if(!convos.length){el.innerHTML='<div class="data-card"><div class="card-title" style="color:var(--muted)">No messages</div></div>';return}
    el.innerHTML=convos.map(function(c){
      var who=c.participants&&c.participants.data?c.participants.data.map(function(p){return p.name}).join(', '):'Unknown';
      var date=new Date(c.updated_time).toLocaleString();
      return '<div class="data-card">'+
        '<div class="card-head"><span class="card-title">'+who+'</span><span class="card-badge badge-cyan">'+c.message_count+' msgs</span></div>'+
        '<div style="font-size:12px;color:#999;margin:4px 0">'+((c.snippet||'').substring(0,100))+'</div>'+
        '<div class="card-meta"><span>'+date+'</span></div>'+
        '<div class="card-actions">'+
          '<button class="card-btn red" onclick="openReply(\''+c.id+'\',\''+who.replace(/'/g,'')+'\')">Reply</button>'+
          '<button class="card-btn" onclick="viewThread(\''+c.id+'\')">View Thread</button>'+
        '</div></div>';
    }).join('');
  }).catch(function(){});
}

window.fbCreatePost=function(){
  var msg=document.getElementById('fbPostText').value.trim();
  var link=document.getElementById('fbPostLink').value.trim();
  if(!msg){alert('Write something first');return}
  fetch('/api/facebook',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({type:'post',message:msg,link:link||undefined})
  }).then(function(r){return r.json()}).then(function(data){
    if(data.success){alert('Posted to Facebook!');document.getElementById('fbPostText').value='';document.getElementById('fbPostLink').value='';loadFBPosts()}
    else{alert('Post failed: '+(data.post&&data.post.error?data.post.error.message:'Unknown error'))}
  }).catch(function(){alert('Failed to post')});
};

window.fbQuickStormPost=function(){
  var topReport=allReports[0];
  var msg='';
  if(topReport){
    msg='HAIL ALERT: '+topReport.size+'" hail ('+topReport.sizeLabel+') reported near '+topReport.location+', '+topReport.state+'.\n\n'+
      'If your vehicle was in this area, it likely has hail damage. Missouri Dent Bully offers FREE hail damage inspections.\n\n'+
      'We fix dents WITHOUT repainting — factory finish preserved. Insurance accepted, zero hassle.\n\n'+
      'Call/text Jason: 636-385-2928\ndentbullyusa.com';
  } else {
    msg='Storm season is here! If your vehicle has hail damage, Missouri Dent Bully offers FREE estimates.\n\n'+
      'Paintless Dent Repair — no repainting, same-day service. 30+ years experience.\n\nCall/text: 636-385-2928';
  }
  document.getElementById('fbPostText').value=msg;
};

window.openReply=function(threadId,name){
  fbReplyRecipient=threadId;
  document.getElementById('fbReplyTo').textContent='Reply to '+name;
  document.getElementById('fbReplyForm').style.display='block';
  document.getElementById('fbReplyText').value='';
  document.getElementById('fbReplyText').focus();
};

window.fbSendReply=function(){
  var msg=document.getElementById('fbReplyText').value.trim();
  if(!msg||!fbReplyRecipient){alert('Type a message');return}
  fetch('/api/facebook',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({type:'send_message',recipient_id:fbReplyRecipient,message:msg})
  }).then(function(r){return r.json()}).then(function(data){
    if(data.success){alert('Reply sent!');document.getElementById('fbReplyForm').style.display='none';loadFBMessages()}
    else{alert('Reply failed')}
  }).catch(function(){alert('Failed to send')});
};

window.loadComments=function(postId){
  fetch('/api/facebook?action=comments&post_id='+postId).then(function(r){return r.json()}).then(function(data){
    var comments=data.comments||[];
    if(!comments.length){alert('No comments on this post');return}
    var text=comments.map(function(c){return(c.from?c.from.name:'Unknown')+': '+c.message}).join('\n\n');
    alert('Comments:\n\n'+text);
  }).catch(function(){});
};

window.viewThread=function(threadId){
  fetch('/api/facebook?action=thread&thread_id='+threadId).then(function(r){return r.json()}).then(function(data){
    var msgs=data.messages||[];
    if(!msgs.length){alert('No messages');return}
    var text=msgs.reverse().map(function(m){return(m.from?m.from.name:'Unknown')+': '+m.message}).join('\n\n');
    alert('Thread:\n\n'+text);
  }).catch(function(){});
};

// ─── Helpers ──────────────────────────────────────────
function filterReports(){
  var q=document.getElementById('searchInput').value.toLowerCase();
  if(!q){renderReports(allReports);renderMap(allReports);return}
  var filtered=allReports.filter(function(r){return(r.location+r.county+r.state+r.comments).toLowerCase().indexOf(q)!==-1});
  renderReports(filtered);
  renderMap(filtered);
}
window.flyTo=function(lat,lon){
  document.querySelector('[data-tab="map"]').click();
  setTimeout(function(){map.flyTo([lat,lon],11,{duration:0.8})},150);
};
window.copyText=function(t){navigator.clipboard.writeText(t).then(function(){alert('Copied!')}).catch(function(){})};
window.copyAdTarget=function(county,state,lat,lon,size){
  var t='Target: '+county+' County, '+state+'\nCenter: '+lat+', '+lon+'\nRadius: 15 miles\nMax Hail: '+size+'"\nAudience: Vehicle owners, auto insurance, car enthusiasts';
  navigator.clipboard.writeText(t).then(function(){alert('Ad targeting copied!')});
};
window.shareNative=function(text){
  if(navigator.share){navigator.share({title:'HailStrike Ops',text:text,url:window.location.href})}
  else{copyText(text+' '+window.location.href)}
};
// ─── Historical Data ──────────────────────────────────
window.loadHistoricalData=function(){
  var dateInput=document.getElementById('historyDate').value;
  if(!dateInput){alert('Pick a date first');return}
  // Convert YYYY-MM-DD to YYMMDD
  var parts=dateInput.split('-');
  var yymmdd=parts[0].substring(2)+parts[1]+parts[2];
  var state=document.getElementById('stateFilter').value;

  document.getElementById('statusText').textContent='Loading '+dateInput+'...';
  fetch('/api/history?date='+yymmdd+(state?'&state='+state:'')).then(function(r){return r.json()}).then(function(data){
    if(!data.reports||!data.reports.length){
      alert('No hail reports found for '+dateInput+(state?' in '+state:''));
      return;
    }
    allReports=data.reports;
    document.getElementById('sReports').textContent=data.summary.totalReports;
    document.getElementById('sMaxSize').textContent=data.summary.maxSize?data.summary.maxSize.toFixed(1)+'"':'0';
    document.getElementById('sZones').textContent=data.summary.countiesHit.length;
    document.getElementById('statusText').textContent='Showing '+dateInput+' — '+data.summary.totalReports+' reports';
    renderReports(allReports);
    renderMap(allReports);
  }).catch(function(e){
    alert('Failed to load data for '+dateInput);
    console.error(e);
  });
};
window.loadToday=function(){
  document.getElementById('historyDate').value='';
  loadStorms();
};

// ─── Business Finder ──────────────────────────────────
window.findBusinesses=function(lat,lon){
  document.getElementById('statusText').textContent='Finding businesses...';
  // Switch to Scout tab if not there
  document.querySelector('[data-tab="scout"]').click();

  fetch('/api/businesses?lat='+lat+'&lon='+lon+'&radius=15').then(function(r){return r.json()}).then(function(data){
    var container=document.getElementById('bizResults');
    container.style.display='block';

    // Render dealerships
    var dealerEl=document.getElementById('bizDealerships');
    var dealers=data.dealerships||[];
    if(!dealers.length){
      dealerEl.innerHTML='<div class="data-card"><div class="card-title" style="color:var(--muted)">No dealerships found within 15 miles</div></div>';
    } else {
      dealerEl.innerHTML=dealers.map(function(b){
        return '<div class="data-card" style="border-left:3px solid var(--red)">'+
          '<div class="card-head"><span class="card-title">'+b.name+'</span><span class="card-badge badge-red">'+b.distance+'</span></div>'+
          '<div class="card-meta" style="flex-direction:column;gap:4px;margin-top:6px">'+
            (b.address?'<span>'+b.address+(b.city?', '+b.city:'')+(b.state?' '+b.state:'')+'</span>':'')+
            (b.phone?'<span>Phone: <b>'+b.phone+'</b></span>':'')+
            (b.website?'<span>Web: <a href="'+b.website+'" target="_blank">'+b.website.substring(0,40)+'</a></span>':'')+
            (b.brand?'<span>Brand: '+b.brand+'</span>':'')+
          '</div>'+
          '<div class="card-actions">'+
            (b.phone?'<a class="card-btn red" href="tel:'+b.phone+'">Call Now</a><a class="card-btn" href="sms:'+b.phone+'">Text</a>':'')+
            '<button class="card-btn" onclick="addDealerFromBiz(\''+b.name.replace(/'/g,'')+'\',\''+b.phone+'\',\''+b.city+'\',\''+b.state+'\')">+ Add Lead</button>'+
            '<button class="card-btn" onclick="flyTo('+b.lat+','+b.lon+')">Map</button>'+
          '</div></div>';
      }).join('');
    }

    // Render body shops
    var bodyEl=document.getElementById('bizBodyShops');
    var bodies=data.bodyShops||[];
    if(!bodies.length){
      bodyEl.innerHTML='<div class="data-card"><div class="card-title" style="color:var(--muted)">No body shops found</div></div>';
    } else {
      bodyEl.innerHTML=bodies.map(function(b){
        return '<div class="data-card" style="border-left:3px solid var(--amber)">'+
          '<div class="card-head"><span class="card-title">'+b.name+'</span><span class="card-badge badge-amber">'+b.distance+'</span></div>'+
          '<div class="card-meta" style="flex-direction:column;gap:4px;margin-top:6px">'+
            (b.address?'<span>'+b.address+(b.city?', '+b.city:'')+'</span>':'')+
            (b.phone?'<span>Phone: <b>'+b.phone+'</b></span>':'')+
            (b.website?'<span><a href="'+b.website+'" target="_blank">Website</a></span>':'')+
          '</div>'+
          '<div class="card-actions">'+
            (b.phone?'<a class="card-btn" href="tel:'+b.phone+'">Call</a>':'')+
            '<button class="card-btn" onclick="flyTo('+b.lat+','+b.lon+')">Map</button>'+
          '</div></div>';
      }).join('');
    }

    // Render auto shops
    var autoEl=document.getElementById('bizAutoShops');
    var autos=data.autoShops||[];
    if(!autos.length){
      autoEl.innerHTML='<div class="data-card"><div class="card-title" style="color:var(--muted)">No other auto businesses found</div></div>';
    } else {
      autoEl.innerHTML=autos.map(function(b){
        return '<div class="data-card">'+
          '<div class="card-head"><span class="card-title">'+b.name+'</span><span class="card-badge badge-cyan">'+b.distance+'</span></div>'+
          '<div class="card-meta">'+
            (b.address?'<span>'+b.address+'</span>':'')+
            (b.phone?'<span>'+b.phone+'</span>':'')+
          '</div>'+
          '<div class="card-actions">'+
            (b.phone?'<a class="card-btn" href="tel:'+b.phone+'">Call</a>':'')+
            '<button class="card-btn" onclick="flyTo('+b.lat+','+b.lon+')">Map</button>'+
          '</div></div>';
      }).join('');
    }

    // Pin businesses on map
    (data.allBusinesses||[]).forEach(function(b){
      var icon=b.category==='dealership'?'red':'blue';
      var m=L.circleMarker([b.lat,b.lon],{radius:6,fillColor:b.category==='dealership'?'#C0392B':'#3498db',fillOpacity:0.9,color:'#fff',weight:2});
      m.bindPopup('<b>'+b.name+'</b><br><span style="color:#999">'+b.category+'</span><br>'+(b.address||'')+(b.phone?'<br><a href="tel:'+b.phone+'">'+b.phone+'</a>':''));
      m.addTo(map);
      markers.push(m);
    });

    document.getElementById('statusText').textContent=data.summary.totalFound+' businesses found';

    // Scroll to results
    container.scrollIntoView({behavior:'smooth'});
  }).catch(function(e){
    alert('Business search failed — try again');
    console.error(e);
  });
};

window.addDealerFromBiz=function(name,phone,city,state){
  dealershipLeads.unshift({type:'dealership',dealerName:name,dealerPhone:phone,dealerCity:city,dealerState:state,dealerType:'found-in-zone',status:'prospecting',createdAt:new Date().toISOString()});
  localStorage.setItem('hs-dealer-leads',JSON.stringify(dealershipLeads));
  renderAllLeads();
  map.closePopup();
  alert(name+' added to Dealership leads!');
};

function isHomeTerritory(comments){
  if(!comments) return false;
  var c=comments.toUpperCase();
  // EAX=Kansas City, LSX=St Louis, SGF=Springfield — all Missouri NWS offices
  return c.indexOf('(EAX)')!==-1||c.indexOf('(LSX)')!==-1||c.indexOf('(SGF)')!==-1;
}

function getWFO(comments){
  if(!comments) return '';
  var match=comments.match(/\(([A-Z]{3})\)\s*$/);
  return match?match[1]:'';
}

function isMediaVerified(comments){
  if(!comments) return false;
  var c=comments.toLowerCase();
  return c.indexOf('social media')!==-1||c.indexOf('photo')!==-1||c.indexOf('video')!==-1||
    c.indexOf('broadcast')!==-1||c.indexOf('picture')!==-1||c.indexOf('media relay')!==-1||
    c.indexOf('public report')!==-1;
}

function debounce(fn,ms){var t;return function(){clearTimeout(t);t=setTimeout(fn,ms)}}

// Convert SPC UTC time (e.g. "2220") to Central Time
function utcToCentral(utcStr){
  if(!utcStr||utcStr.length<4) return utcStr;
  var h=parseInt(utcStr.substring(0,2));
  var m=utcStr.substring(2,4);
  // CDT is UTC-5, CST is UTC-6. Use -5 for Apr-Oct (daylight saving)
  var month=new Date().getMonth(); // 0-11
  var offset=(month>=2&&month<=10)?5:6; // CDT Mar-Oct, CST Nov-Feb
  h=h-offset;
  if(h<0) h+=24;
  var ampm=h>=12?'PM':'AM';
  var h12=h%12;if(h12===0)h12=12;
  return h12+':'+m+' '+ampm;
}

})();
