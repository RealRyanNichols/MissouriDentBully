const https = require('https');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'HailStrikeOps/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { lat, lon, radius = '10', type = 'all' } = req.query || {};

  if (!lat || !lon) {
    return res.status(400).json({ error: 'lat and lon required. Example: /api/businesses?lat=38.5&lon=-92.5&radius=10' });
  }

  try {
    const results = { dealerships: [], bodyShops: [], autoShops: [], allBusinesses: [] };

    // Use Overpass API (OpenStreetMap) to find businesses — free, no API key needed
    const overpassUrl = 'https://overpass-api.de/api/interpreter';
    const radiusMeters = parseFloat(radius) * 1609.34; // miles to meters
    const centerLat = parseFloat(lat);
    const centerLon = parseFloat(lon);

    // Query for auto-related businesses
    const query = `[out:json][timeout:15];
(
  node["shop"="car"](around:${radiusMeters},${centerLat},${centerLon});
  node["shop"="car_repair"](around:${radiusMeters},${centerLat},${centerLon});
  node["shop"="car_parts"](around:${radiusMeters},${centerLat},${centerLon});
  node["amenity"="car_wash"](around:${radiusMeters},${centerLat},${centerLon});
  way["shop"="car"](around:${radiusMeters},${centerLat},${centerLon});
  way["shop"="car_repair"](around:${radiusMeters},${centerLat},${centerLon});
  way["amenity"="car_wash"](around:${radiusMeters},${centerLat},${centerLon});
);
out center;`;

    const postData = 'data=' + encodeURIComponent(query);

    const overpassData = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'overpass-api.de',
        path: '/api/interpreter',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'HailStrikeOps/1.0'
        }
      };
      const req = https.request(options, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    // Process results
    (overpassData.elements || []).forEach(el => {
      const tags = el.tags || {};
      const elLat = el.lat || (el.center ? el.center.lat : null);
      const elLon = el.lon || (el.center ? el.center.lon : null);
      if (!elLat || !elLon) return;

      const biz = {
        name: tags.name || tags.brand || 'Unknown Business',
        type: tags.shop || tags.amenity || 'auto',
        address: [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ') || '',
        city: tags['addr:city'] || '',
        state: tags['addr:state'] || '',
        zip: tags['addr:postcode'] || '',
        phone: tags.phone || tags['contact:phone'] || '',
        website: tags.website || tags['contact:website'] || '',
        email: tags.email || tags['contact:email'] || '',
        facebook: tags['contact:facebook'] || tags.facebook || '',
        instagram: tags['contact:instagram'] || '',
        twitter: tags['contact:twitter'] || '',
        openingHours: tags.opening_hours || '',
        brand: tags.brand || '',
        operator: tags.operator || '',
        lat: elLat,
        lon: elLon,
        distance: getDistance(centerLat, centerLon, elLat, elLon).toFixed(1) + ' mi'
      };

      // Categorize
      if (tags.shop === 'car' || (tags.name && tags.name.toLowerCase().match(/dealer|motors|auto\s*sales|chrysler|ford|chevy|toyota|honda|gmc|dodge/))) {
        biz.category = 'dealership';
        results.dealerships.push(biz);
      } else if (tags.shop === 'car_repair' || (tags.name && tags.name.toLowerCase().match(/body|collision|repair|dent|paint/))) {
        biz.category = 'body_shop';
        results.bodyShops.push(biz);
      } else {
        biz.category = 'auto_shop';
        results.autoShops.push(biz);
      }
      results.allBusinesses.push(biz);
    });

    // Sort each by distance
    results.dealerships.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
    results.bodyShops.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
    results.autoShops.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
    results.allBusinesses.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

    results.summary = {
      totalFound: results.allBusinesses.length,
      dealerships: results.dealerships.length,
      bodyShops: results.bodyShops.length,
      autoShops: results.autoShops.length,
      searchRadius: radius + ' miles',
      center: { lat: centerLat, lon: centerLon }
    };

    res.json(results);
  } catch (err) {
    console.error('Business finder error:', err.message);
    res.status(500).json({ error: 'Failed to find businesses' });
  }
};

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
