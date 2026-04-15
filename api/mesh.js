const https = require('https');

const S3_BUCKET = 'https://unidata-nexrad-level3.s3.amazonaws.com';

// Radar stations covering Missouri + surrounding states
const STATION_LOCS = {
  EAX: [38.810, -94.264], LSX: [38.699, -90.683], SGF: [37.236, -93.400],
  ICT: [37.654, -97.443], TOP: [39.067, -95.627], OAX: [41.320, -96.367],
  DVN: [41.612, -90.581], ILX: [40.151, -89.337], PAH: [37.069, -88.772],
  LZK: [34.836, -92.262], TSA: [36.131, -95.976], INX: [36.175, -95.564],
  IWX: [41.359, -85.700], IND: [39.708, -86.280], LOT: [41.604, -88.085]
};

function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

// Convert azimuth (degrees) + range (nautical miles) to lat/lon
function azRanToLatLon(azDeg, rangeNM, radarLat, radarLon) {
  const rangeKM = rangeNM * 1.852;
  const azRad = azDeg * Math.PI / 180;
  const R = 6371;
  const lat1 = radarLat * Math.PI / 180;
  const lon1 = radarLon * Math.PI / 180;
  const d = rangeKM / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(azRad));
  const lon2 = lon1 + Math.atan2(Math.sin(azRad) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
}

function getMeshLabel(inches) {
  if (inches >= 4) return 'Softball+';
  if (inches >= 2.75) return 'Baseball';
  if (inches >= 2) return 'Hen Egg';
  if (inches >= 1.75) return 'Golf Ball';
  if (inches >= 1) return 'Quarter';
  if (inches >= 0.75) return 'Penny';
  return 'Small';
}

// Parse NEXRAD Level III NMD (Product 141) binary file
function parseNMD(buf, stationId) {
  if (buf.length < 200) return []; // Too small = no data

  const radarLoc = STATION_LOCS[stationId];
  if (!radarLoc) return [];

  try {
    // Find binary data start (skip WMO text headers)
    let msgStart = 0;
    for (let i = 0; i < 40; i++) {
      if (buf[i] === 0x0d && buf[i + 1] === 0x0d && buf[i + 2] === 0x0a) {
        msgStart = i + 3;
      }
    }
    for (let i = msgStart; i < msgStart + 20 && i < buf.length - 2; i++) {
      if (buf[i] === 0x0d && buf[i + 1] === 0x0d && buf[i + 2] === 0x0a) {
        msgStart = i + 3;
        break;
      }
    }

    // Verify message code 141
    const msgCode = buf.readInt16BE(msgStart);
    if (msgCode !== 141) return [];

    // Get radar location from product
    const pdb = msgStart + 18;
    const prodRadarLat = buf.readInt32BE(pdb + 2) / 1000;
    const prodRadarLon = buf.readInt32BE(pdb + 6) / 1000;

    // Get tabular block offset
    const tabOffset = buf.readUInt32BE(pdb + 90);
    if (tabOffset === 0) return []; // No tabular data

    const tabStart = msgStart + (tabOffset * 2);
    if (tabStart >= buf.length) return [];

    // Extract ASCII text from tabular block — contains MESH values and AZ/RAN
    let textContent = '';
    for (let i = tabStart; i < buf.length; i++) {
      const b = buf[i];
      if (b >= 32 && b <= 126) textContent += String.fromCharCode(b);
      else textContent += '\n';
    }

    const cells = [];
    const lines = textContent.split('\n').filter(l => l.trim());

    // Find STMID line to get cell IDs and MESH values
    let stormIds = [];
    let azValues = [];
    let ranValues = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Look for STMID line: "CIR STMID 312    N2 311    N2 669    A8"
      if (line.indexOf('STMID') !== -1) {
        // Extract storm IDs and their MESH values (3-digit numbers)
        const parts = line.split(/\s+/);
        for (let j = 0; j < parts.length; j++) {
          const num = parseInt(parts[j]);
          if (num >= 50 && num <= 999 && parts[j].length === 3) {
            stormIds.push({ id: parts[j], mesh: num / 100 });
          }
        }
      }

      // Look for AZ RAN line: "AZ    RAN 196   108 196   105 359    99"
      if (line.indexOf('AZ') !== -1 && line.indexOf('RAN') !== -1) {
        const parts = line.replace(/AZ\s+RAN/, '').trim().split(/\s+/);
        for (let j = 0; j < parts.length - 1; j += 2) {
          const az = parseInt(parts[j]);
          const ran = parseInt(parts[j + 1]);
          if (!isNaN(az) && !isNaN(ran) && az >= 0 && az <= 360 && ran > 0 && ran < 300) {
            azValues.push(az);
            ranValues.push(ran);
          }
        }
      }
    }

    // Combine storm IDs with their AZ/RAN positions
    for (let i = 0; i < stormIds.length && i < azValues.length; i++) {
      const [lat, lon] = azRanToLatLon(azValues[i], ranValues[i], prodRadarLat, prodRadarLon);
      const meshVal = stormIds[i].mesh;

      // Sanity check
      if (meshVal > 0 && meshVal < 10 && Math.abs(lat) < 90 && Math.abs(lon) < 180) {
        cells.push({
          stormId: stormIds[i].id,
          meshValue: meshVal,
          meshLabel: getMeshLabel(meshVal),
          lat: parseFloat(lat.toFixed(4)),
          lon: parseFloat(lon.toFixed(4)),
          azimuth: azValues[i],
          range: ranValues[i],
          station: stationId,
          radarLat: prodRadarLat,
          radarLon: prodRadarLon
        });
      }
    }

    return cells;
  } catch (e) {
    console.error('NMD parse error for ' + stationId + ':', e.message);
    return [];
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { stations = 'EAX,LSX,SGF', hours = '3', date = '' } = req.query || {};
  const stationList = stations.split(',').map(s => s.trim().toUpperCase());

  try {
    const allCells = [];
    const now = new Date();

    for (const station of stationList) {
      if (!STATION_LOCS[station]) continue;

      // Build date prefix
      let datePrefix;
      if (date) {
        datePrefix = date.replace(/-/g, '_');
      } else {
        datePrefix = `${now.getUTCFullYear()}_${String(now.getUTCMonth() + 1).padStart(2, '0')}_${String(now.getUTCDate()).padStart(2, '0')}`;
      }

      const prefix = `${station}_NMD_${datePrefix}`;
      const listUrl = `${S3_BUCKET}/?list-type=2&prefix=${prefix}&max-keys=200`;

      try {
        const listXml = await fetchText(listUrl);
        const keys = [];
        const keyRegex = /<Key>([^<]+)<\/Key>/g;
        let match;
        while ((match = keyRegex.exec(listXml)) !== null) {
          keys.push(match[1]);
        }

        if (!keys.length) continue;

        // Get scans from the requested time window
        const maxScans = Math.min(parseInt(hours) * 15, keys.length);
        const recentKeys = keys.slice(-maxScans);

        // Parse each file (limit to last 20 to avoid timeout)
        for (const key of recentKeys.slice(-20)) {
          try {
            const buffer = await fetchBinary(`${S3_BUCKET}/${key}`);
            const cells = parseNMD(buffer, station);
            if (cells.length > 0) {
              const timeParts = key.split('_');
              const scanTime = timeParts.slice(3).join(':');
              cells.forEach(c => {
                c.scanTime = scanTime;
                c.scanKey = key;
              });
              allCells.push(...cells);
            }
          } catch (e) {
            // Skip failed downloads
          }
        }
      } catch (e) {
        console.error('Failed to list files for ' + station + ':', e.message);
      }
    }

    // Deduplicate — same storm cell across scans, keep the max MESH
    const uniqueCells = {};
    allCells.forEach(c => {
      const key = `${c.station}_${c.stormId}`;
      if (!uniqueCells[key] || c.meshValue > uniqueCells[key].meshValue) {
        uniqueCells[key] = c;
      }
    });

    const finalCells = Object.values(uniqueCells).sort((a, b) => b.meshValue - a.meshValue);

    res.json({
      stations: stationList,
      totalScansProcessed: allCells.length,
      meshCells: finalCells,
      totalCells: finalCells.length,
      source: 'NOAA NEXRAD Level III Product 141 (Digital MESH) — unidata-nexrad-level3 S3',
      availableStations: Object.keys(STATION_LOCS)
    });
  } catch (err) {
    console.error('MESH API error:', err.message);
    res.status(500).json({ error: 'Failed to process MESH data', details: err.message });
  }
};
