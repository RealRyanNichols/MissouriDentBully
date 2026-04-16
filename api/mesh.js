const https = require('https');

const S3_BUCKET = 'https://unidata-nexrad-level3.s3.amazonaws.com';

const RADARS = {
  EAX:[38.810,-94.264],LSX:[38.699,-90.683],SGF:[37.236,-93.400],
  ICT:[37.654,-97.443],TOP:[39.067,-95.627],OAX:[41.320,-96.367],
  DVN:[41.612,-90.581],ILX:[40.151,-89.337],PAH:[37.069,-88.772],
  LZK:[34.836,-92.262],TSA:[36.131,-95.976],INX:[36.175,-95.564],
  IWX:[41.359,-85.700],IND:[39.708,-86.280],LOT:[41.604,-88.085],
  MPX:[44.849,-93.565],DMX:[41.731,-93.723],FSD:[43.588,-96.729],
  UDX:[44.125,-102.830],ABR:[45.456,-98.413],GLD:[39.367,-101.700],
  DDC:[37.761,-99.969],VNX:[36.741,-98.128],FWD:[32.573,-97.303],
  SHV:[32.451,-93.841],LIX:[30.337,-89.826],JAN:[32.318,-90.080],
  BMX:[33.172,-86.770],HUN:[34.930,-86.083],MRX:[36.169,-83.402],
  OHX:[36.247,-86.563],LMK:[38.064,-85.944],ILN:[39.420,-83.822],
  CLE:[41.413,-81.860],BUF:[42.949,-78.737],OKX:[40.866,-72.864]
};

function fetchBinary(url){
  return new Promise(function(resolve,reject){
    https.get(url,function(res){
      if(res.statusCode!==200){reject(new Error('HTTP '+res.statusCode));return}
      var chunks=[];
      res.on('data',function(c){chunks.push(c)});
      res.on('end',function(){resolve(Buffer.concat(chunks))});
    }).on('error',reject);
  });
}

function fetchText(url){
  return new Promise(function(resolve,reject){
    https.get(url,function(res){
      var d='';res.on('data',function(c){d+=c});res.on('end',function(){resolve(d)});
    }).on('error',reject);
  });
}

// Parse NMD (Product 141) binary file — extract contour vectors
function parseNMD(buf, radarLat, radarLon){
  if(buf.length<200) return {contours:[],cells:[]};

  // Skip WMO text headers
  var off=0;
  for(var i=0;i<40;i++){if(buf[i]===0x0d&&buf[i+1]===0x0d&&buf[i+2]===0x0a)off=i+3}
  for(var i=off;i<off+20&&i<buf.length-2;i++){if(buf[i]===0x0d&&buf[i+1]===0x0d&&buf[i+2]===0x0a){off=i+3;break}}

  if(buf.readInt16BE(off)!==141) return {contours:[],cells:[]};

  var contours=[];
  var cells=[];
  var currentColor=0;

  // Scan for Linked Vector packets (code 6) and Color Level packets (code 23)
  // Starting after PDB (offset + 18 header + 94 PDB = offset + 112)
  for(var pos=off+112; pos<buf.length-10; pos+=2){
    var code=buf.readUInt16BE(pos);

    // Set Color Level packet
    if(code===23){
      var len=buf.readUInt16BE(pos+2);
      if(len>=2&&len<100){
        currentColor=buf.readUInt16BE(pos+4);
      }
    }

    // Linked Vector Packet — contour polygon vertices
    if(code===6){
      var len=buf.readUInt16BE(pos+2);
      if(len>4&&len<5000){
        var numPairs=Math.floor(len/4);
        var verts=[];
        for(var p=0;p<numPairs;p++){
          var vi=buf.readInt16BE(pos+4+p*4);
          var vj=buf.readInt16BE(pos+4+p*4+2);
          // I,J are in 1/4 km from radar center
          var kmX=vi/4.0;
          var kmY=vj/4.0;
          var lat=radarLat+kmY/111.32;
          var lon=radarLon+kmX/(111.32*Math.cos(radarLat*Math.PI/180));
          verts.push([parseFloat(lat.toFixed(5)),parseFloat(lon.toFixed(5))]);
        }
        if(verts.length>=2){
          contours.push({color:currentColor,vertices:verts});
        }
        pos+=2+len;
      }
    }
  }

  // Extract cell info from tabular text
  var pdb=off+18;
  var tabOff=buf.readUInt32BE(pdb+90);
  if(tabOff>0){
    var tabStart=off+(tabOff*2);
    var txt='';
    for(var i=tabStart;i<buf.length;i++){
      var b=buf[i];
      if(b>=32&&b<=126)txt+=String.fromCharCode(b);
      else txt+=' ';
    }
    // Extract STMID and AZ/RAN
    var stmMatch=txt.match(/STMID\s+([\s\S]*?)(?:SR|$)/);
    var azMatch=txt.match(/AZ\s+RAN\s+([\d\s]+)/);
    if(stmMatch&&azMatch){
      var ids=stmMatch[1].trim().split(/\s+/).filter(function(s){return/^\d{3}$/.test(s)});
      var azran=azMatch[1].trim().split(/\s+/).map(Number);
      for(var i=0;i<ids.length&&i*2+1<azran.length;i++){
        var meshVal=parseInt(ids[i])/100;
        if(meshVal>0&&meshVal<10){
          var az=azran[i*2];
          var ran=azran[i*2+1];
          var rKm=ran*1.852;
          var azRad=az*Math.PI/180;
          var R=6371;
          var lat1=radarLat*Math.PI/180;
          var lon1=radarLon*Math.PI/180;
          var d=rKm/R;
          var lat2=Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(azRad));
          var lon2=lon1+Math.atan2(Math.sin(azRad)*Math.sin(d)*Math.cos(lat1),Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
          cells.push({
            id:ids[i],meshValue:meshVal,
            lat:parseFloat((lat2*180/Math.PI).toFixed(4)),
            lon:parseFloat((lon2*180/Math.PI).toFixed(4)),
            azimuth:az,range:ran
          });
        }
      }
    }
  }

  return {contours:contours,cells:cells};
}

module.exports = async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();

  var stations=(req.query.stations||'EAX,LSX,SGF').split(',').map(function(s){return s.trim().toUpperCase()});
  var hours=parseInt(req.query.hours||'3');
  var date=req.query.date||'';

  try{
    var allContours=[];
    var allCells=[];
    var now=new Date();
    var datePrefix=date?date.replace(/-/g,'_'):
      now.getUTCFullYear()+'_'+String(now.getUTCMonth()+1).padStart(2,'0')+'_'+String(now.getUTCDate()).padStart(2,'0');

    for(var s=0;s<stations.length;s++){
      var station=stations[s];
      var radarLoc=RADARS[station];
      if(!radarLoc) continue;

      var prefix=station+'_NMD_'+datePrefix;
      try{
        var xml=await fetchText(S3_BUCKET+'/?list-type=2&prefix='+prefix+'&max-keys=200');
        var keys=[];
        var re=/<Key>([^<]+)<\/Key>/g;
        var m;
        while((m=re.exec(xml))!==null) keys.push(m[1]);
        if(!keys.length) continue;

        // Get last N scans
        var maxScans=Math.min(hours*15,keys.length);
        var recent=keys.slice(-maxScans);

        // Parse each (limit to avoid timeout)
        for(var k=0;k<Math.min(recent.length,15);k++){
          try{
            var buffer=await fetchBinary(S3_BUCKET+'/'+recent[recent.length-1-k]);
            var result=parseNMD(buffer,radarLoc[0],radarLoc[1]);
            result.contours.forEach(function(c){
              c.station=station;
              c.scanKey=recent[recent.length-1-k];
              allContours.push(c);
            });
            result.cells.forEach(function(c){
              c.station=station;
              allCells.push(c);
            });
            // If we found contours, we have what we need from this station
            if(result.contours.length>0) break;
          }catch(e){}
        }
      }catch(e){}
    }

    res.json({
      stations:stations,
      contours:allContours,
      cells:allCells,
      totalContours:allContours.length,
      totalCells:allCells.length,
      source:'NEXRAD Level III Product 141 (Digital MESH) — contour vectors'
    });
  }catch(err){
    res.status(500).json({error:'MESH processing failed',details:err.message});
  }
};
