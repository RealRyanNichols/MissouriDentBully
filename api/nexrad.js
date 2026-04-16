const https = require('https');
const zlib = require('zlib');

// NEXRAD Level II data from AWS S3 — raw volume scans
const L2_BUCKET = 'https://noaa-nexrad-level2.s3.amazonaws.com';
// Level III hail products
const L3_BUCKET = 'https://unidata-nexrad-level3.s3.amazonaws.com';

// Radar stations
const RADARS = {
  KEAX:{lat:38.810,lon:-94.264,name:'Kansas City'},
  KLSX:{lat:38.699,lon:-90.683,name:'St Louis'},
  KSGF:{lat:37.236,lon:-93.400,name:'Springfield'},
  KICT:{lat:37.654,lon:-97.443,name:'Wichita'},
  KTOP:{lat:39.067,lon:-95.627,name:'Topeka'},
  KOAX:{lat:41.320,lon:-96.367,name:'Omaha'},
  KDVN:{lat:41.612,lon:-90.581,name:'Davenport'},
  KILX:{lat:40.151,lon:-89.337,name:'Lincoln IL'},
  KPAH:{lat:37.069,lon:-88.772,name:'Paducah'},
  KLZK:{lat:34.836,lon:-92.262,name:'Little Rock'},
  KTSA:{lat:36.131,lon:-95.976,name:'Tulsa'},
  KINX:{lat:36.175,lon:-95.564,name:'Tulsa KINX'}
};

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

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

// List available scans for a radar station on a given date
async function listScans(station, date) {
  // Level II path: YYYY/MM/DD/KXXX/
  const prefix = `${date.replace(/-/g, '/')}/${station}/`;
  const url = `${L2_BUCKET}/?list-type=2&prefix=${prefix}&max-keys=300`;
  const xml = await fetchText(url);
  const keys = [];
  const re = /<Key>([^<]+)<\/Key>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    // Skip MDM files (metadata), only get actual scan files
    if (!m[1].endsWith('_MDM') && !m[1].endsWith('.gz')) {
      keys.push(m[1]);
    }
  }
  return keys;
}

// Parse Level II file header to get scan metadata
function parseL2Header(buf) {
  try {
    // Volume Header Record (24 bytes)
    const tape = buf.toString('ascii', 0, 9).trim();
    const dateJ = buf.readUInt32BE(12); // Julian date
    const timeMs = buf.readUInt32BE(16); // Time in ms past midnight
    const stationId = buf.toString('ascii', 20, 24).trim();

    return { tape, dateJ, timeMs, stationId, fileSize: buf.length };
  } catch (e) {
    return null;
  }
}

// Extract high-reflectivity gates from a Level II scan
// This is simplified — looks for reflectivity values >45 dBZ which indicate potential hail
function extractHailSignatures(buf, radarLat, radarLon) {
  const signatures = [];

  try {
    // Level II files after the header contain compressed messages
    // Each message has radial data with reflectivity values
    // We scan for high-reflectivity patterns

    let offset = 24; // Skip volume header
    const msgSize = buf.length;

    // Look for Message Type 31 (digital radial data)
    // These contain the actual reflectivity gates
    while (offset < msgSize - 100) {
      // Try to find message headers
      // Message 31 header starts with specific patterns
      const byte1 = buf[offset];
      const byte2 = buf[offset + 1];

      // Look for reflectivity data blocks
      // In Level II, reflectivity is stored as unsigned bytes
      // Value = (byte - 2) / 2.0 in dBZ (for legacy format)
      // Value > 100 means > 49 dBZ (potential hail)

      // Scan a window of bytes for high-reflectivity clusters
      if (byte1 > 110 && byte2 > 100) {
        // Found high reflectivity cluster — this is a simplified detection
        // In production, we'd properly parse the radial format
        // For now, flag the approximate location

        // We can't get exact coordinates without full radial parsing
        // but we know high reflectivity exists in this scan
        signatures.push({
          offset: offset,
          value: (byte1 - 2) / 2.0, // approximate dBZ
          raw: byte1
        });
      }
      offset += 1;
    }

    return signatures;
  } catch (e) {
    return [];
  }
}

// Parse Level III Hail Index product (NHI - product code 59)
// This is the official NWS hail detection output
async function parseHailIndex(station, date) {
  const stationShort = station.replace('K', '');
  const dateFormatted = date.replace(/-/g, '_');
  const prefix = `${stationShort}_NHI_${dateFormatted}`;
  const listUrl = `${L3_BUCKET}/?list-type=2&prefix=${prefix}&max-keys=100`;

  try {
    const xml = await fetchText(listUrl);
    const keys = [];
    const re = /<Key>([^<]+)<\/Key>/g;
    let m;
    while ((m = re.exec(xml)) !== null) keys.push(m[1]);

    if (!keys.length) return [];

    const hailCells = [];
    // Process last 10 scans
    for (const key of keys.slice(-10)) {
      try {
        const buf = await fetchBinary(`${L3_BUCKET}/${key}`);
        if (buf.length < 150) continue;

        // Extract text data from tabular block (same approach as NMD)
        let textContent = '';
        for (let i = 100; i < buf.length; i++) {
          const b = buf[i];
          if (b >= 32 && b <= 126) textContent += String.fromCharCode(b);
          else textContent += '\n';
        }

        // Look for POH (Probability of Hail) and POSH (Prob of Severe Hail)
        // and MEHS (Max Estimated Hail Size) in the text
        const lines = textContent.split('\n').filter(l => l.trim());
        let azValues = [], ranValues = [], pohValues = [], poshValues = [], mehsValues = [];

        for (const line of lines) {
          if (line.indexOf('AZ') !== -1 && line.indexOf('RAN') !== -1) {
            const parts = line.replace(/AZ\s+RAN/, '').trim().split(/\s+/);
            for (let j = 0; j < parts.length - 1; j += 2) {
              const az = parseInt(parts[j]);
              const ran = parseInt(parts[j + 1]);
              if (!isNaN(az) && !isNaN(ran) && az >= 0 && az <= 360 && ran > 0) {
                azValues.push(az);
                ranValues.push(ran);
              }
            }
          }
          if (line.indexOf('POH') !== -1 && line.indexOf('POSH') !== -1) {
            const parts = line.replace(/POH\s+POSH/, '').trim().split(/\s+/);
            for (let j = 0; j < parts.length - 1; j += 2) {
              pohValues.push(parseInt(parts[j]) || 0);
              poshValues.push(parseInt(parts[j + 1]) || 0);
            }
          }
          if (line.indexOf('MEHS') !== -1) {
            const parts = line.replace(/MEHS/, '').trim().split(/\s+/);
            parts.forEach(p => {
              const v = parseFloat(p);
              if (!isNaN(v) && v > 0 && v < 10) mehsValues.push(v);
            });
          }
        }

        // Convert to lat/lon
        const radar = RADARS[station];
        if (!radar) continue;

        for (let i = 0; i < azValues.length && i < ranValues.length; i++) {
          const [lat, lon] = azRanToLatLon(azValues[i], ranValues[i], radar.lat, radar.lon);
          hailCells.push({
            lat: parseFloat(lat.toFixed(4)),
            lon: parseFloat(lon.toFixed(4)),
            azimuth: azValues[i],
            range: ranValues[i],
            poh: pohValues[i] || null,
            posh: poshValues[i] || null,
            mehs: mehsValues[i] || null,
            station: station,
            scanKey: key,
            source: 'NWS Hail Index (NHI)'
          });
        }
      } catch (e) { /* skip failed files */ }
    }

    return hailCells;
  } catch (e) {
    return [];
  }
}

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action = 'status', station = 'KEAX', date = '' } = req.query || {};

  try {
    // Default to today
    const now = new Date();
    const targetDate = date || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

    if (action === 'status') {
      // List available scans
      const scans = await listScans(station, targetDate);
      return res.json({
        station,
        date: targetDate,
        radar: RADARS[station] || null,
        totalScans: scans.length,
        latestScan: scans[scans.length - 1] || null,
        availableRadars: Object.keys(RADARS)
      });
    }

    if (action === 'hail') {
      // Get hail index data from Level III
      const cells = await parseHailIndex(station, targetDate);
      return res.json({
        station,
        date: targetDate,
        hailCells: cells,
        totalCells: cells.length,
        source: 'NEXRAD Level III Hail Index (NHI)'
      });
    }

    if (action === 'scans') {
      // List all available scans
      const scans = await listScans(station, targetDate);
      return res.json({ station, date: targetDate, scans: scans.slice(-50) });
    }

    res.json({ actions: ['status', 'hail', 'scans'], station, date: targetDate });
  } catch (err) {
    console.error('NEXRAD API error:', err.message);
    res.status(500).json({ error: 'Failed to process radar data', details: err.message });
  }
};
