const https = require('https');

// NEXRAD Level III Digital MESH (NMD) parser
// Product code 141 — Maximum Estimated Size of Hail
// Data from NOAA AWS S3: unidata-nexrad-level3

const S3_BUCKET = 'https://unidata-nexrad-level3.s3.amazonaws.com';

// Missouri + surrounding state radar stations
const STATIONS = ['EAX','LSX','SGF','ICT','TOP','OAX','DVN','ILX','LSX','PAH','LZK','TSA','INX'];

function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
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

// Radar station locations (lat, lon)
const STATION_LOCS = {
  EAX: [38.810, -94.264], LSX: [38.699, -90.683], SGF: [37.236, -93.400],
  ICT: [37.654, -97.443], TOP: [39.067, -95.627], OAX: [41.320, -96.367],
  DVN: [41.612, -90.581], ILX: [40.151, -89.337], PAH: [37.069, -88.772],
  LZK: [34.836, -92.262], TSA: [36.131, -95.976], INX: [36.175, -95.564]
};

// Parse NEXRAD Level III product header and extract radial/raster data
function parseNMD(buffer, stationId) {
  if (buffer.length < 150) return null; // Empty product, no data

  const results = [];
  const stationLoc = STATION_LOCS[stationId];
  if (!stationLoc) return null;

  try {
    // Skip WMO header — find the start of the product (byte 0x00 after headers)
    let offset = 0;
    // Find end of text headers (look for \r\r\n pattern followed by binary)
    for (let i = 0; i < Math.min(30, buffer.length - 2); i++) {
      if (buffer[i] === 0x0d && buffer[i + 1] === 0x0d && buffer[i + 2] === 0x0a) {
        offset = i + 3;
      }
    }

    // Skip second header line if present
    for (let i = offset; i < Math.min(offset + 20, buffer.length - 2); i++) {
      if (buffer[i] === 0x0d && buffer[i + 1] === 0x0d && buffer[i + 2] === 0x0a) {
        offset = i + 3;
        break;
      }
    }

    // Now at the Message Header Block
    // Bytes 0-1: Message Code (should be 141 for NMD)
    if (offset + 100 > buffer.length) return null;

    // Product description block starts at offset
    // We need to find the Graphic Alphanumeric section which contains
    // the MESH contour vectors

    // Parse the product looking for coordinate data
    // NMD uses Geographic Coordinates in the data
    // The product contains Storm Cell ID, MESH value, and polygon vertices

    // Scan for storm cell data patterns
    // Look for sequences that match coordinate pairs
    const meshCells = [];
    let i = offset;

    while (i < buffer.length - 20) {
      // Look for what appears to be MESH value strings (3 digit numbers in ASCII)
      if (buffer[i] >= 0x30 && buffer[i] <= 0x39 &&
          buffer[i+1] >= 0x30 && buffer[i+1] <= 0x39 &&
          buffer[i+2] >= 0x30 && buffer[i+2] <= 0x39 &&
          buffer[i+3] === 0x20) {
        // Found a 3-digit number followed by space — likely MESH value
        const meshStr = String.fromCharCode(buffer[i], buffer[i+1], buffer[i+2]);
        const meshValue = parseInt(meshStr);

        // MESH values are in hundredths of inches
        // e.g., 175 = 1.75 inches, 312 = 3.12 inches
        if (meshValue > 0 && meshValue < 999) {
          const meshInches = meshValue / 100;

          // Look backwards for coordinate data
          // Coordinates in NMD are stored as 2-byte signed integers
          // representing 1/10 degree offsets from radar location
          // Search nearby bytes for coordinate pairs
          let searchStart = Math.max(offset, i - 60);
          const coords = [];

          for (let j = searchStart; j < i; j += 2) {
            if (j + 3 < buffer.length) {
              const x = buffer.readInt16BE(j);
              const y = buffer.readInt16BE(j + 2);
              // Check if these look like reasonable coordinate offsets
              // Values should be within ~250km of radar
              if (Math.abs(x) < 2500 && Math.abs(y) < 2500 && (Math.abs(x) > 10 || Math.abs(y) > 10)) {
                // Convert from 1/10 km offset to lat/lon
                const lat = stationLoc[0] + (y / 10) / 111.32;
                const lon = stationLoc[1] + (x / 10) / (111.32 * Math.cos(stationLoc[0] * Math.PI / 180));
                // Sanity check — should be within ~300 miles of radar
                if (Math.abs(lat - stationLoc[0]) < 4 && Math.abs(lon - stationLoc[1]) < 5) {
                  coords.push([lat, lon]);
                }
              }
            }
          }

          if (coords.length >= 2) {
            meshCells.push({
              meshValue: meshInches,
              meshLabel: getMeshLabel(meshInches),
              coords: coords,
              station: stationId
            });
          }
        }
      }
      i++;
    }

    return meshCells;
  } catch (e) {
    console.error('NMD parse error:', e.message);
    return null;
  }
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { station = 'EAX', date = '', hours = '2' } = req.query || {};

  try {
    // Get file listing for the station and time period
    const now = new Date();
    const targetDate = date || `${now.getUTCFullYear()}_${String(now.getUTCMonth()+1).padStart(2,'0')}_${String(now.getUTCDate()).padStart(2,'0')}`;
    const datePrefix = targetDate.replace(/-/g, '_');

    const prefix = `${station.toUpperCase()}_NMD_${datePrefix}`;
    const listUrl = `${S3_BUCKET}/?list-type=2&prefix=${prefix}&max-keys=100`;

    const listXml = await fetchText(listUrl);
    const keys = [];
    const keyRegex = /<Key>([^<]+)<\/Key>/g;
    let match;
    while ((match = keyRegex.exec(listXml)) !== null) {
      keys.push(match[1]);
    }

    if (!keys.length) {
      return res.json({
        station: station.toUpperCase(),
        date: targetDate,
        meshCells: [],
        message: 'No MESH data found for this station/date. Try a different date or station.',
        availableStations: Object.keys(STATION_LOCS)
      });
    }

    // Get the most recent files (last N based on hours parameter)
    const recentKeys = keys.slice(-Math.min(keys.length, parseInt(hours) * 15)); // ~4 scans per hour

    // Parse each file
    const allCells = [];
    for (const key of recentKeys.slice(-10)) { // Limit to last 10 scans
      try {
        const buffer = await fetchBinary(`${S3_BUCKET}/${key}`);
        const cells = parseNMD(buffer, station.toUpperCase());
        if (cells && cells.length > 0) {
          cells.forEach(c => {
            c.scanTime = key.split('_').slice(3).join(':').replace(/:(\d{2})$/, '');
            allCells.push(c);
          });
        }
      } catch (e) {
        // Skip failed downloads
      }
    }

    res.json({
      station: station.toUpperCase(),
      stationLocation: STATION_LOCS[station.toUpperCase()],
      date: targetDate,
      scansProcessed: recentKeys.length,
      meshCells: allCells,
      totalCells: allCells.length,
      availableStations: Object.keys(STATION_LOCS),
      source: 'NOAA NEXRAD Level III — Product 141 (Digital MESH)',
      bucket: 'unidata-nexrad-level3 (AWS S3, public)'
    });
  } catch (err) {
    console.error('MESH API error:', err.message);
    res.status(500).json({ error: 'Failed to fetch MESH data', details: err.message });
  }
};
