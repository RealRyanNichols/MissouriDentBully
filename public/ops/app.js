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

  // Street-level map with labels, cities, neighborhoods — NOT dark tiles
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png',{
    maxZoom:19,subdomains:'abcd'
  }).addTo(map);

  // State/county boundary overlay for clarity
  L.tileLayer('https://stamen-tiles-{s}.a.ssl.fastly.net/toner-lines/{z}/{x}/{y}{r}.png',{
    maxZoom:19,subdomains:'abcd',opacity:0.15
  }).addTo(map);

  layers.ref=L.tileLayer.wms('https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi',{layers:'nexrad-n0q-900913',transparent:true,format:'image/png',opacity:0.35}).addTo(map);
  layers.vel=L.tileLayer.wms('https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0u.cgi',{layers:'nexrad-n0u-900913',transparent:true,format:'image/png',opacity:0.35});
  layers.pre=L.tileLayer.wms('https://mesonet.agron.iastate.edu/cgi-bin/wms/iowa/mrms_p1h.cgi',{layers:'mrms_p1h',transparent:true,format:'image/png',opacity:0.3});
}

window.toggleLayer=function(id){
  layerState[id]=!layerState[id];
  if(layerState[id]) layers[id].addTo(map); else map.removeLayer(layers[id]);
  document.getElementById('btn'+id.charAt(0).toUpperCase()+id.slice(1)).classList.toggle('active',layerState[id]);
};
window.fitAllMarkers=function(){
  if(markers.length){var g=L.featureGroup(markers);map.fitBounds(g.getBounds().pad(0.1))}
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

// ─── Render Map Markers ───────────────────────────────
function renderMap(reports){
  markers.forEach(function(m){map.removeLayer(m)});
  markers=[];
  reports.forEach(function(r){
    var color=r.size>=2.75?'#ff1744':r.size>=1.75?'#C0392B':r.size>=1?'#ffab00':'#00e5ff';
    var radius=r.size>=2.75?9:r.size>=1.75?7:r.size>=1?5:4;
    var m=L.circleMarker([r.lat,r.lon],{radius:radius,fillColor:color,fillOpacity:0.8,color:'#fff',weight:1.5,bubblingMouseEvents:false});
    if(r.size>=1.75) L.circleMarker([r.lat,r.lon],{radius:radius+5,fillColor:color,fillOpacity:0.12,stroke:false,interactive:false}).addTo(map);
    m.bindPopup('<b>'+r.location+', '+r.state+'</b><br>Size: <b style="color:'+color+'">'+r.size+'" — '+r.sizeLabel+'</b><br>County: '+r.county+'<br>Time: '+r.time+' '+(r.day==='today'?'Today':'Yesterday')+(r.comments?'<br><i>'+r.comments+'</i>':'')+'<br><br><button class="card-btn red" onclick="addLeadFromMap(\''+r.location+'\',\''+r.county+'\',\''+r.state+'\')">+ Add Lead</button>');
    m.addTo(map);
    markers.push(m);
  });
  if(markers.length) fitAllMarkers();
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
        '<a class="card-btn" href="https://twitter.com/intent/tweet?text='+shareText+'" target="_blank">\u{1D54F} Post to X</a>'+
        '<a class="card-btn" href="https://www.facebook.com/sharer/sharer.php?quote='+shareText+'" target="_blank">\uD83D\uDCF1 Facebook</a>'+
        '<a class="card-btn" href="sms:?body='+shareText+'">\\uD83D\\uDCF2 Text</a>'+
        '<a class="card-btn" href="mailto:?subject=Storm%20Alert&body='+shareText+'">\\u2709 Email</a>'+
        '<button class="card-btn" onclick="shareNative(\''+((a.headline||'').replace(/'/g,''))+'\')">\\uD83D\\uDD17 Share</button>'+
      '</div></div>';
  }).join('');
}

// ─── Leads ────────────────────────────────────────────
function loadLeads(){
  leads=JSON.parse(localStorage.getItem('hs-leads')||'[]');
  renderLeads();
  document.querySelectorAll('.filter-chip').forEach(function(c){
    c.addEventListener('click',function(){
      document.querySelectorAll('.filter-chip').forEach(function(b){b.classList.remove('active')});
      c.classList.add('active');
      renderLeads(c.dataset.lf);
    });
  });
}
function renderLeads(filter){
  filter=filter||'all';
  var filtered=filter==='all'?leads:leads.filter(function(l){return l.status===filter});
  var el=document.getElementById('leadsList');
  if(!filtered.length){el.innerHTML='<div class="data-card"><div class="card-title" style="color:var(--muted)">No leads yet. Add from storm reports or manually.</div></div>';return}
  el.innerHTML=filtered.map(function(l,i){
    var bc=l.status==='new'?'badge-cyan':l.status==='contacted'?'badge-amber':l.status==='scheduled'?'badge-green':'badge-red';
    return '<div class="data-card">'+
      '<div class="card-head"><span class="card-title">'+(l.name||l.location||'Lead #'+(i+1))+'</span><span class="card-badge '+bc+'">'+l.status+'</span></div>'+
      '<div class="card-meta">'+(l.phone?'<span>'+l.phone+'</span>':'')+(l.vehicle?'<span>'+l.vehicle+'</span>':'')+'<span>'+(l.damageType||l.damage||'')+'</span>'+(l.city?'<span>'+l.city+', '+l.state+'</span>':'')+'</div>'+
      '<div class="card-actions">'+
        (l.phone?'<a class="card-btn red" href="tel:'+l.phone+'">Call</a><a class="card-btn" href="sms:'+l.phone+'">Text</a>':'') +
        '<button class="card-btn" onclick="updateLeadStatus('+i+')">Next Status</button>'+
        '<button class="card-btn" onclick="deleteLead('+i+')" style="color:var(--red)">Delete</button>'+
      '</div></div>';
  }).join('');
}

window.showAddLead=function(){document.getElementById('addLeadForm').style.display='block'};
window.hideAddLead=function(){document.getElementById('addLeadForm').style.display='none'};
window.saveLead=function(){
  var l={
    name:document.getElementById('lName').value,
    phone:document.getElementById('lPhone').value,
    email:document.getElementById('lEmail').value,
    address:document.getElementById('lAddress').value,
    city:document.getElementById('lCity').value,
    state:document.getElementById('lState').value,
    vehicle:document.getElementById('lVehicle').value,
    damageType:document.getElementById('lDamage').value,
    source:document.getElementById('lSource').value,
    notes:document.getElementById('lNotes').value,
    status:'new',
    createdAt:new Date().toISOString()
  };
  leads.unshift(l);
  localStorage.setItem('hs-leads',JSON.stringify(leads));
  renderLeads();
  hideAddLead();
  // Also POST to server
  fetch('/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(l)}).catch(function(){});
  ['lName','lPhone','lEmail','lAddress','lCity','lVehicle','lNotes'].forEach(function(id){document.getElementById(id).value=''});
};
window.addLeadFromMap=function(loc,county,state){
  leads.unshift({location:loc,county:county,state:state,damageType:'auto-hail',source:'storm-scout',status:'new',createdAt:new Date().toISOString()});
  localStorage.setItem('hs-leads',JSON.stringify(leads));
  map.closePopup();
};
window.addLeadFromZone=function(county,state){
  leads.unshift({location:county+' County zone',county:county,state:state,damageType:'auto-hail',source:'storm-scout',status:'new',createdAt:new Date().toISOString()});
  localStorage.setItem('hs-leads',JSON.stringify(leads));
  renderLeads();
};
window.updateLeadStatus=function(i){
  var order=['new','contacted','estimate sent','appointment booked','scheduled','insurance filed','in progress','completed','lost'];
  var cur=order.indexOf(leads[i].status);
  leads[i].status=order[(cur+1)%order.length];
  localStorage.setItem('hs-leads',JSON.stringify(leads));
  renderLeads();
};
window.deleteLead=function(i){
  if(confirm('Delete this lead?')){leads.splice(i,1);localStorage.setItem('hs-leads',JSON.stringify(leads));renderLeads()}
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
