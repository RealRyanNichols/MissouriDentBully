const https = require('https');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'HailStrikeOps/1.0', 'Accept': 'application/geo+json' } }, (res) => {
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

  const { type = 'all', state = '', lat, lon, radius = '100' } = req.query || {};

  try {
    const result = {
      radar: {},
      alerts: [],
      watches: [],
      warnings: [],
      stations: [],
      fetchedAt: new Date().toISOString()
    };

    // ── 1. NEXRAD Radar Station Data ──
    // Same source as RadarScope — NOAA NEXRAD network
    result.radar = {
      tileUrls: {
        // Iowa State NEXRAD composites — same data RadarScope uses
        reflectivity: 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi',
        velocity: 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0u.cgi',
        // MRMS (Multi-Radar Multi-Sensor) — higher resolution
        mrms_reflectivity: 'https://mesonet.agron.iastate.edu/cgi-bin/wms/iowa/mrms_lcref.cgi',
        // Precipitation
        precip_1hr: 'https://mesonet.agron.iastate.edu/cgi-bin/wms/iowa/mrms_p1h.cgi',
        precip_24hr: 'https://mesonet.agron.iastate.edu/cgi-bin/wms/iowa/mrms_p24h.cgi'
      },
      wmsParams: {
        service: 'WMS',
        version: '1.1.1',
        request: 'GetMap',
        format: 'image/png',
        transparent: true,
        srs: 'EPSG:3857'
      },
      note: 'These are the same NEXRAD Level II/III data feeds that RadarScope uses. Iowa State Mesonet provides free WMS tile access to the full NEXRAD network.'
    };

    // ── 2. Active Severe Weather Alerts ──
    let alertUrl = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert';
    if (state) alertUrl += `&area=${state.toUpperCase()}`;

    try {
      const alertData = await fetchJSON(alertUrl);
      const features = alertData.features || [];

      features.forEach(f => {
        const p = f.properties;
        const alert = {
          id: p.id,
          event: p.event,
          headline: p.headline,
          severity: p.severity,
          certainty: p.certainty,
          urgency: p.urgency,
          description: p.description ? p.description.substring(0, 500) : '',
          instruction: p.instruction ? p.instruction.substring(0, 300) : '',
          areas: p.areaDesc,
          onset: p.onset,
          expires: p.expires,
          sender: p.senderName,
          category: p.category
        };

        // Categorize
        const evt = (p.event || '').toLowerCase();
        if (evt.includes('watch')) result.watches.push(alert);
        else if (evt.includes('warning')) result.warnings.push(alert);
        else result.alerts.push(alert);
      });
    } catch (e) {
      console.error('NWS alerts fetch failed:', e.message);
    }

    // ── 3. Nearby Radar Stations ──
    // NEXRAD station list for reference
    try {
      const stationsUrl = 'https://api.weather.gov/radar/stations?stationType=WSR-88D';
      const stationData = await fetchJSON(stationsUrl);
      const stations = (stationData.features || []).map(f => ({
        id: f.properties.stationIdentifier,
        name: f.properties.name,
        type: f.properties.stationType,
        lat: f.geometry ? f.geometry.coordinates[1] : null,
        lon: f.geometry ? f.geometry.coordinates[0] : null,
        elevation: f.properties.elevation ? f.properties.elevation.value : null
      }));

      // If lat/lon provided, sort by distance
      if (lat && lon) {
        const userLat = parseFloat(lat);
        const userLon = parseFloat(lon);
        stations.forEach(s => {
          if (s.lat && s.lon) {
            const dLat = s.lat - userLat;
            const dLon = s.lon - userLon;
            s.distance = Math.sqrt(dLat * dLat + dLon * dLon) * 69; // rough miles
          }
        });
        stations.sort((a, b) => (a.distance || 999) - (b.distance || 999));
        result.stations = stations.slice(0, 10);
      } else {
        result.stations = stations.slice(0, 20);
      }
    } catch (e) {
      console.error('Radar stations fetch failed:', e.message);
    }

    // ── 4. Summary ──
    result.summary = {
      totalAlerts: result.alerts.length,
      totalWatches: result.watches.length,
      totalWarnings: result.warnings.length,
      severeWarnings: result.warnings.filter(w =>
        w.event.toLowerCase().includes('tornado') ||
        w.event.toLowerCase().includes('severe thunderstorm')
      ).length,
      hailRelated: [...result.watches, ...result.warnings, ...result.alerts].filter(a =>
        (a.description || '').toLowerCase().includes('hail') ||
        (a.event || '').toLowerCase().includes('hail')
      ).length,
      radarStations: result.stations.length
    };

    res.json(result);
  } catch (err) {
    console.error('Radar API error:', err.message);
    res.status(500).json({ error: 'Failed to fetch radar data' });
  }
};
