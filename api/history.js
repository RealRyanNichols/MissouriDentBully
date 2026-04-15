const fs = require('fs');
const path = require('path');
const https = require('https');

// Store history in /tmp on Vercel (ephemeral) — for persistent storage, use a database
// For now, we fetch historical data from SPC archives on demand

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'HailStrikeOps/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        https.get(res.headers.location, { headers: { 'User-Agent': 'HailStrikeOps/1.0' } }, (r2) => {
          let d = ''; r2.on('data', c => d += c); r2.on('end', () => resolve(d));
        }).on('error', reject);
        return;
      }
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function getSizeLabel(size) {
  if (size >= 4.5) return 'Softball';
  if (size >= 2.75) return 'Baseball';
  if (size >= 2) return 'Hen Egg';
  if (size >= 1.75) return 'Golf Ball';
  if (size >= 1.5) return 'Ping Pong';
  if (size >= 1) return 'Quarter';
  if (size >= 0.75) return 'Penny';
  return 'Pea/Marble';
}

function parseSPCCsv(csvData, dateStr) {
  const reports = [];
  const lines = csvData.split('\n').filter(l => l.trim() && !l.startsWith('Time'));
  for (const line of lines) {
    const p = line.split(',');
    if (p.length >= 8) {
      let size = parseFloat(p[1]) || 0;
      if (size > 6 && size > 20) size = size / 100;
      if (size > 6 || size <= 0) continue;
      const lat = parseFloat(p[5]);
      const lon = parseFloat(p[6]);
      if (!isNaN(lat) && !isNaN(lon)) {
        reports.push({
          time: p[0].trim(),
          size,
          sizeLabel: getSizeLabel(size),
          location: p[2].trim(),
          county: p[3].trim(),
          state: p[4].trim(),
          lat, lon,
          comments: p.slice(7).join(',').trim(),
          date: dateStr,
          source: 'SPC'
        });
      }
    }
  }
  return reports;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { date, state = '' } = req.query || {};

  if (!date) {
    return res.json({
      message: 'Provide a date parameter in YYMMDD format (e.g. 250415 for April 15, 2025)',
      example: '/api/history?date=250415&state=MO',
      note: 'SPC archives go back years. All data is from NOAA Storm Prediction Center.'
    });
  }

  try {
    // SPC archive URL format: YYMMDD
    const spcUrl = `https://www.spc.noaa.gov/climo/reports/${date}_rpts_filtered_hail.csv`;

    let csvData = '';
    try {
      csvData = await fetchText(spcUrl);
    } catch (e) {
      // Try alternate format
      try {
        const altUrl = `https://www.spc.noaa.gov/climo/reports/${date}_rpts_hail.csv`;
        csvData = await fetchText(altUrl);
      } catch (e2) {
        return res.json({ date, reports: [], error: 'No data found for this date. Check the date format (YYMMDD).' });
      }
    }

    let reports = parseSPCCsv(csvData, date);

    // Filter by state
    if (state) {
      reports = reports.filter(r => r.state.toLowerCase() === state.toLowerCase());
    }

    // Sort by size
    reports.sort((a, b) => b.size - a.size);

    // Summary
    const summary = {
      date,
      totalReports: reports.length,
      maxSize: reports.length ? Math.max(...reports.map(r => r.size)) : 0,
      statesHit: [...new Set(reports.map(r => r.state))],
      countiesHit: [...new Set(reports.map(r => r.county + ', ' + r.state))].slice(0, 50)
    };

    res.json({ date, summary, reports });
  } catch (err) {
    console.error('History API error:', err.message);
    res.status(500).json({ error: 'Failed to fetch historical data' });
  }
};
