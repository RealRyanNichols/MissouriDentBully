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

  const { lat, lon, radius = '50', state = '' } = req.query || {};

  try {
    const result = {
      hailReports: [],
      activeAlerts: [],
      radarIndicated: [],
      scoutingZones: [],
      adTargeting: {},
      fetchedAt: new Date().toISOString()
    };

    // ── 1. Latest SPC Storm Reports (hail) ──
    for (const day of ['today', 'yesterday']) {
      try {
        const csvData = await new Promise((resolve, reject) => {
          const url = `https://www.spc.noaa.gov/climo/reports/${day === 'today' ? 'today' : 'yesterday'}_filtered_hail.csv`;
          https.get(url, { headers: { 'User-Agent': 'HailStrikeOps/1.0' } }, (r) => {
            if (r.statusCode === 301 || r.statusCode === 302) {
              https.get(r.headers.location, { headers: { 'User-Agent': 'HailStrikeOps/1.0' } }, (r2) => {
                let d = ''; r2.on('data', c => d += c); r2.on('end', () => resolve(d));
              }).on('error', reject);
              return;
            }
            let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d));
          }).on('error', reject);
        });

        const lines = csvData.split('\n').filter(l => l.trim() && !l.startsWith('Time'));
        for (const line of lines) {
          const p = line.split(',');
          if (p.length >= 8) {
            let size = parseFloat(p[1]) || 0;
            // SPC reports size in inches — sanity check
            // Largest hail ever recorded in US was 8" (Vivian, SD 2010)
            // Anything over 6 is almost certainly a parsing error or speed field
            if (size > 6) {
              // SPC sometimes has speed in this field — skip unrealistic values
              // Or it could be in hundredths: 175 = 1.75"
              if (size > 20) size = size / 100;
              if (size > 6) continue; // Still unrealistic, skip
            }
            if (size <= 0) continue; // No size data
            const rLat = parseFloat(p[5]);
            const rLon = parseFloat(p[6]);
            if (!isNaN(rLat) && !isNaN(rLon)) {
              const report = {
                time: p[0].trim(),
                size,
                sizeLabel: getSizeLabel(size),
                damageLevel: getDamageLevel(size),
                location: p[2].trim(),
                county: p[3].trim(),
                state: p[4].trim(),
                lat: rLat,
                lon: rLon,
                comments: p.slice(7).join(',').trim(),
                day,
                source: 'SPC',
                verified: true
              };

              // Filter by state if provided
              if (state && report.state.toLowerCase() !== state.toLowerCase()) continue;

              // Filter by radius if lat/lon provided
              if (lat && lon) {
                const dist = getDistance(parseFloat(lat), parseFloat(lon), rLat, rLon);
                if (dist > parseFloat(radius)) continue;
                report.distanceMiles = Math.round(dist);
              }

              result.hailReports.push(report);
            }
          }
        }
      } catch (e) {
        console.error(`SPC ${day} fetch failed:`, e.message);
      }
    }

    // Sort by size descending (biggest = most damage = best opportunity)
    result.hailReports.sort((a, b) => b.size - a.size);

    // ── 2. Active severe weather alerts ──
    let alertUrl = 'https://api.weather.gov/alerts/active?event=Severe%20Thunderstorm%20Warning';
    if (state) alertUrl = `https://api.weather.gov/alerts/active?area=${state.toUpperCase()}`;

    try {
      const alertData = await fetchJSON(alertUrl);
      result.activeAlerts = (alertData.features || [])
        .filter(f => {
          const desc = ((f.properties.description || '') + (f.properties.event || '')).toLowerCase();
          return desc.includes('hail') || desc.includes('severe') || desc.includes('tornado');
        })
        .map(f => {
          const p = f.properties;
          // Extract hail size from description
          const hailMatch = (p.description || '').match(/(\d+(?:\.\d+)?)\s*inch\s*hail/i);
          const radarHail = (p.description || '').match(/radar indicated/i);

          return {
            event: p.event,
            headline: p.headline,
            severity: p.severity,
            areas: p.areaDesc,
            onset: p.onset,
            expires: p.expires,
            hailSize: hailMatch ? parseFloat(hailMatch[1]) : null,
            radarIndicated: !!radarHail,
            description: (p.description || '').substring(0, 600),
            instruction: (p.instruction || '').substring(0, 300),
            sender: p.senderName
          };
        });

      // Extract radar-indicated hail
      result.radarIndicated = result.activeAlerts.filter(a => a.radarIndicated || a.hailSize);
    } catch (e) {
      console.error('Alerts fetch failed:', e.message);
    }

    // ── 3. Generate scouting zones ──
    // Group reports by county/state and rank by opportunity
    const zones = {};
    result.hailReports.forEach(r => {
      const key = `${r.county}, ${r.state}`;
      if (!zones[key]) {
        zones[key] = {
          county: r.county,
          state: r.state,
          lat: r.lat,
          lon: r.lon,
          reportCount: 0,
          maxSize: 0,
          avgSize: 0,
          sizes: [],
          damageLevel: 'low',
          locations: [],
          opportunityScore: 0
        };
      }
      zones[key].reportCount++;
      zones[key].maxSize = Math.max(zones[key].maxSize, r.size);
      zones[key].sizes.push(r.size);
      zones[key].locations.push(r.location);
      if (r.distanceMiles !== undefined) zones[key].distanceMiles = r.distanceMiles;
    });

    Object.values(zones).forEach(z => {
      z.avgSize = (z.sizes.reduce((s, v) => s + v, 0) / z.sizes.length).toFixed(2);
      z.damageLevel = getDamageLevel(z.maxSize);

      // Opportunity score: bigger hail + more reports = better opportunity
      z.opportunityScore = Math.round(
        (z.maxSize * 30) + (z.reportCount * 15) + (z.avgSize * 20)
      );
      // Penalize distance if available
      if (z.distanceMiles) z.opportunityScore -= Math.round(z.distanceMiles * 0.5);

      z.locations = [...new Set(z.locations)].slice(0, 5);
      delete z.sizes;
    });

    result.scoutingZones = Object.values(zones).sort((a, b) => b.opportunityScore - a.opportunityScore);

    // ── 4. Ad targeting data ──
    // Generate zip code / area targeting for Meta ads
    const topZones = result.scoutingZones.slice(0, 10);
    result.adTargeting = {
      recommendedAreas: topZones.map(z => ({
        area: `${z.county} County, ${z.state}`,
        lat: z.lat,
        lon: z.lon,
        radiusMiles: 15,
        hailSize: z.maxSize,
        damageLevel: z.damageLevel,
        opportunityScore: z.opportunityScore,
        suggestedBudget: z.opportunityScore > 80 ? '$50-100/day' : z.opportunityScore > 50 ? '$25-50/day' : '$10-25/day',
        suggestedDuration: z.maxSize >= 1.75 ? '14 days' : '7 days'
      })),
      adCopy: {
        headline1: 'Hail Hit Your Car? FREE Dent Estimate',
        headline2: 'Hail Damage? We Fix It — No Repainting',
        headline3: 'Storm Damage Repair — Insurance Accepted',
        body1: `Your area just got hit with ${topZones[0] ? topZones[0].maxSize + '"' : ''} hail. Missouri Dent Bully removes hail dents WITHOUT repainting — factory finish preserved. FREE estimates, insurance accepted. Call/text 636-385-2928`,
        body2: 'Paintless Dent Repair by Missouri Dent Bully. 30+ years experience. 5.0 Google rating. We come to YOU. Most repairs same-day. Call 636-385-2928 for your FREE estimate.',
        cta: 'Call Now',
        targetAudiences: [
          'Vehicle owners in hail-affected zip codes',
          'People who searched "hail damage repair" or "dent repair"',
          'Car enthusiasts / auto detailing interest',
          'Insurance claim related searches',
          'Homeowners in affected areas (for roofing referrals)'
        ]
      },
      platforms: {
        facebook: {
          campaignObjective: 'LEAD_GENERATION',
          targeting: 'Geo-target affected counties with 15-mile radius',
          budget: 'Start at $25/day per county, scale based on lead flow',
          note: 'Meta Ads API integration coming — for now, use these targeting params manually in Meta Business Suite'
        },
        instagram: {
          format: 'Stories + Reels — before/after dent repair videos',
          targeting: 'Same geo as Facebook, add "automotive" interests'
        }
      }
    };

    // ── 5. Summary ──
    result.summary = {
      totalReports: result.hailReports.length,
      severeReports: result.hailReports.filter(r => r.size >= 1.75).length,
      maxHailSize: result.hailReports.length ? Math.max(...result.hailReports.map(r => r.size)) : 0,
      scoutingZones: result.scoutingZones.length,
      topZone: result.scoutingZones[0] || null,
      activeAlerts: result.activeAlerts.length,
      radarIndicatedHail: result.radarIndicated.length,
      recommendation: result.scoutingZones.length > 0
        ? `Deploy to ${result.scoutingZones[0].county} County, ${result.scoutingZones[0].state} — ${result.scoutingZones[0].maxSize}" hail, opportunity score ${result.scoutingZones[0].opportunityScore}`
        : 'No significant hail activity detected. Monitor radar for developing storms.'
    };

    res.json(result);
  } catch (err) {
    console.error('Scout API error:', err.message);
    res.status(500).json({ error: 'Failed to generate scouting data' });
  }
};

// ─── Helper functions ─────────────────────────────────
function getSizeLabel(size) {
  if (size >= 4.5) return 'Softball';
  if (size >= 4) return 'Grapefruit';
  if (size >= 2.75) return 'Baseball';
  if (size >= 2.5) return 'Tennis Ball';
  if (size >= 2) return 'Hen Egg';
  if (size >= 1.75) return 'Golf Ball';
  if (size >= 1.5) return 'Ping Pong';
  if (size >= 1) return 'Quarter';
  if (size >= 0.88) return 'Nickel';
  if (size >= 0.75) return 'Penny';
  return 'Pea/Marble';
}

function getDamageLevel(size) {
  if (size >= 2.75) return 'catastrophic';
  if (size >= 1.75) return 'severe';
  if (size >= 1) return 'significant';
  if (size >= 0.75) return 'moderate';
  return 'minor';
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
