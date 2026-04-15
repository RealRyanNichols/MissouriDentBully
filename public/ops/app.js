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
var layers={ref:null,vel:null,pre:null};
var layerState={ref:true,vel:false,pre:false};
var markers=[];
var demoCache={}; // demographics cache by state

// ─── Init ─────────────────────────────────────────────
function initApp(){
  initMap();
  initTabs();
  loadStorms();
  loadLeads();
  loadTemplates();
  setInterval(loadStorms,5*60*1000);
  document.getElementById('stateFilter').addEventListener('change',loadStorms);
  document.getElementById('searchInput').addEventListener('input',debounce(filterReports,300));
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

  layers.ref=L.tileLayer.wms('https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi',{layers:'nexrad-n0q-900913',transparent:true,format:'image/png',opacity:0.55}).addTo(map);
  layers.vel=L.tileLayer.wms('https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0u.cgi',{layers:'nexrad-n0u-900913',transparent:true,format:'image/png',opacity:0.35});
  layers.pre=L.tileLayer.wms('https://mesonet.agron.iastate.edu/cgi-bin/wms/iowa/mrms_p1h.cgi',{layers:'mrms_p1h',transparent:true,format:'image/png',opacity:0.3});
}

window.toggleLayer=function(id){
  try{
    layerState[id]=!layerState[id];
    if(layerState[id]){
      if(!map.hasLayer(layers[id])) layers[id].addTo(map);
    } else {
      if(map.hasLayer(layers[id])) map.removeLayer(layers[id]);
    }
  }catch(e){console.error('Toggle layer error:',e)}
  var btnId='btn'+id.charAt(0).toUpperCase()+id.slice(1);
  var btn=document.getElementById(btnId);
  if(btn){
    if(layerState[id]){btn.classList.add('active');btn.textContent=btn.textContent.replace(' OFF',' ON').replace(/^(Radar|Velocity|Precip)$/,'$1')}
    else{btn.classList.remove('active')}
  }
};
window.fitAllMarkers=function(){
  try{
    if(markers.length>0){
      var g=L.featureGroup(markers);
      map.fitBounds(g.getBounds().pad(0.15));
    } else {
      map.setView([38.5,-92.5],7); // Default to Missouri
    }
  }catch(e){console.error('Fit markers error:',e)}
};

// ─── Tabs ─────────────────────────────────────────────
function initTabs(){
  document.querySelectorAll('.tab').forEach(function(t){
    t.addEventListener('click',function(){
      document.querySelectorAll('.tab').forEach(function(b){b.classList.remove('active')});
      document.querySelectorAll('.tab-panel').forEach(function(p){p.classList.remove('active')});
      t.classList.add('active');
      document.getElementById('panel-'+t.dataset.tab).classList.add('active');
      if(t.dataset.tab==='map') setTimeout(function(){map.invalidateSize()},100);
    });
  });
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
    demoCache[state]={summary:data.summary,byCounty:byCounty};
    return demoCache[state];
  }).catch(function(){return null});
}

// ─── Load demographics for all states in reports ──────
function loadAllDemographics(reports){
  var states=[...new Set(reports.map(function(r){return r.state}))];
  return Promise.all(states.map(function(s){return fetchDemographics(s)}));
}

// ─── Get county demo data ─────────────────────────────
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

      var demo=getCountyDemo(r.county,r.state);
      var impact=estimateImpact(demo,r.size);

      var popup='<div style="min-width:220px">'+
        '<b style="font-size:14px">'+r.location+', '+r.state+'</b><br>'+
        '<div style="margin:6px 0;padding:6px 0;border-top:1px solid #2a2a3e;border-bottom:1px solid #2a2a3e">'+
          '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">Hail Size</span><b style="color:'+color+'">'+r.size+'" — '+r.sizeLabel+'</b></div>'+
          '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">County</span><b>'+r.county+'</b></div>'+
          '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">Time</span><b>'+r.time+' '+(r.day==='today'?'Today':'Yesterday')+'</b></div>'+
        '</div>'+
        '<div style="margin:6px 0;padding:6px 0;border-bottom:1px solid #2a2a3e">'+
          '<div style="font-size:10px;color:#C0392B;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:700">Estimated Impact</div>'+
          '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">Vehicles Affected</span><b style="color:#00e5ff">~'+impact.vehicles+'</b></div>'+
          '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">Houses Affected</span><b style="color:#ffab00">~'+impact.houses+'</b></div>'+
          '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">Median Income</span><b>'+impact.income+'</b></div>'+
          '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">Median Home Value</span><b>'+impact.homeValue+'</b></div>'+
          '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">Est. People Affected</span><b>'+impact.pop+'</b></div>'+
          '<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#6a6a8a">County Population</span><b>'+impact.totalPop+'</b></div>'+
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
  var sorted=reports.slice().sort(function(a,b){return b.size-a.size});
  el.innerHTML=sorted.slice(0,50).map(function(r){
    var bc=r.size>=2.75?'badge-hotred':r.size>=1.75?'badge-red':r.size>=1?'badge-amber':'badge-cyan';
    return '<div class="data-card" onclick="flyTo('+r.lat+','+r.lon+')">'+
      '<div class="card-head"><span class="card-title">'+r.location+', '+r.state+'</span><span class="card-badge '+bc+'">'+r.size+'" '+r.sizeLabel+'</span></div>'+
      '<div class="card-meta"><span>'+r.county+' Co.</span><span>'+r.time+' '+(r.day==='today'?'Today':'Yest.')+'</span><span>'+r.damageLevel+'</span></div>'+
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
      '<div class="card-actions"><button class="card-btn red" onclick="event.stopPropagation();addLeadFromZone(\''+z.county+'\',\''+z.state+'\')">+ Add Lead</button><button class="card-btn" onclick="event.stopPropagation();copyAdTarget(\''+z.county+'\',\''+z.state+'\','+z.lat+','+z.lon+','+z.maxSize+')">Copy Ad Target</button></div>'+
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
function debounce(fn,ms){var t;return function(){clearTimeout(t);t=setTimeout(fn,ms)}}

})();
