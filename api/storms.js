const https = require('https');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'HailStrikeOps/1.0 (contact@dentbullyusa.com)', 'Accept': 'application/geo+json' } }, (res) => {
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

  const { days = '7', state = '' } = req.query || {};

  try {
    // Fetch recent hail reports from NOAA Storm Prediction Center
    const now = new Date();
    const start = new Date(now.getTime() - parseInt(days) * 24 * 60 * 60 * 1000);
    const startStr = start.toISOString().split('T')[0];
    const endStr = now.toISOString().split('T')[0];

    // NWS alerts API for active severe weather
    const alertsUrl = 'https://api.weather.gov/alerts/active?event=Severe%20Thunderstorm%20Warning,Hail';
    let alerts = [];
    try {
      const alertData = await fetchJSON(alertsUrl);
      alerts = (alertData.features || []).map(f => ({
        id: f.properties.id,
        event: f.properties.event,
        headline: f.properties.headline,
        description: f.properties.description,
        severity: f.properties.severity,
        urgency: f.properties.urgency,
        areas: f.properties.areaDesc,
        onset: f.properties.onset,
        expires: f.properties.expires,
        senderName: f.properties.senderName
      }));
    } catch (e) {
      console.error('Alerts fetch failed:', e.message);
    }

    // SPC storm reports - today and yesterday
    const spcReports = [];
    const dateOptions = ['today']; // Today only — no yesterday
    for (const day of dateOptions) {
      try {
        const spcUrl = `https://www.spc.noaa.gov/climo/reports/${day === 'today' ? 'today' : 'yesterday'}_filtered_hail.csv`;
        const csvData = await new Promise((resolve, reject) => {
          https.get(spcUrl, { headers: { 'User-Agent': 'HailStrikeOps/1.0' } }, (r) => {
            // Follow redirects
            if (r.statusCode === 301 || r.statusCode === 302) {
              https.get(r.headers.location, { headers: { 'User-Agent': 'HailStrikeOps/1.0' } }, (r2) => {
                let d = '';
                r2.on('data', c => d += c);
                r2.on('end', () => resolve(d));
              }).on('error', reject);
              return;
            }
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => resolve(d));
          }).on('error', reject);
        });

        // Parse CSV: Time,Size,Location,County,State,Lat,Lon,Comments
        const lines = csvData.split('\n').filter(l => l.trim() && !l.startsWith('Time'));
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length >= 8) {
            let size = parseFloat(parts[1]) || 0;
            // Sanity check — largest US hail ever was 8" (Vivian SD)
            if (size > 6 && size > 20) size = size / 100; // Convert from hundredths
            if (size > 6 || size <= 0) continue; // Skip unrealistic or empty
            const lat = parseFloat(parts[5]);
            const lon = parseFloat(parts[6]);
            if (!isNaN(lat) && !isNaN(lon)) {
              spcReports.push({
                time: parts[0].trim(),
                size: size,
                location: parts[2].trim(),
                county: parts[3].trim(),
                state: parts[4].trim(),
                lat: lat,
                lon: lon,
                comments: parts.slice(7).join(',').trim(),
                day: day,
                type: 'hail'
              });
            }
          }
        }
      } catch (e) {
        console.error(`SPC ${day} fetch failed:`, e.message);
      }
    }

    // Filter by state if provided
    const filtered = state
      ? spcReports.filter(r => r.state.toLowerCase() === state.toLowerCase())
      : spcReports;

    // Calculate summary stats
    const totalReports = filtered.length;
    const maxSize = filtered.reduce((max, r) => Math.max(max, r.size), 0);
    const avgSize = totalReports > 0 ? (filtered.reduce((sum, r) => sum + r.size, 0) / totalReports).toFixed(2) : 0;
    const statesAffected = [...new Set(filtered.map(r => r.state))];
    const countiesAffected = [...new Set(filtered.map(r => `${r.county}, ${r.state}`))];

    res.json({
      summary: {
        totalReports,
        maxHailSize: maxSize,
        avgHailSize: parseFloat(avgSize),
        statesAffected: statesAffected.length,
        countiesAffected: countiesAffected.length,
        statesList: statesAffected,
        countiesList: countiesAffected.slice(0, 50)
      },
      reports: filtered,
      alerts: alerts,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Storms API error:', err.message);
    res.status(500).json({ error: 'Failed to fetch storm data' });
  }
};
