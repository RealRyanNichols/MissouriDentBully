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

  const { lat, lon, state = 'MO' } = req.query || {};

  // US Census API — free, no key needed for basic queries
  // Get state-level demographic data
  const stateFips = {
    'AL':'01','AK':'02','AZ':'04','AR':'05','CA':'06','CO':'08','CT':'09',
    'DE':'10','FL':'12','GA':'13','HI':'15','ID':'16','IL':'17','IN':'18',
    'IA':'19','KS':'20','KY':'21','LA':'22','ME':'23','MD':'24','MA':'25',
    'MI':'26','MN':'27','MS':'28','MO':'29','MT':'30','NE':'31','NV':'32',
    'NH':'33','NJ':'34','NM':'35','NY':'36','NC':'37','ND':'38','OH':'39',
    'OK':'40','OR':'41','PA':'42','RI':'44','SC':'45','SD':'46','TN':'47',
    'TX':'48','UT':'49','VT':'50','VA':'51','WA':'53','WV':'54','WI':'55','WY':'56'
  };

  try {
    const fips = stateFips[state.toUpperCase()] || '29'; // Default MO

    // Fetch population, median income, housing units, median home value
    const censusUrl = `https://api.census.gov/data/2022/acs/acs5?get=NAME,B01003_001E,B19013_001E,B25001_001E,B25077_001E,B25002_001E,B25003_001E&for=county:*&in=state:${fips}`;

    let counties = [];
    try {
      const censusData = await fetchJSON(censusUrl);
      // First row is headers, rest is data
      if (Array.isArray(censusData) && censusData.length > 1) {
        const headers = censusData[0];
        counties = censusData.slice(1).map(row => ({
          name: row[0],
          population: parseInt(row[1]) || 0,
          medianIncome: parseInt(row[2]) || 0,
          totalHousingUnits: parseInt(row[3]) || 0,
          medianHomeValue: parseInt(row[4]) || 0,
          occupiedUnits: parseInt(row[5]) || 0,
          renterOccupied: parseInt(row[6]) || 0,
          stateFips: row[7],
          countyFips: row[8]
        }));
      }
    } catch (e) {
      console.error('Census fetch failed:', e.message);
    }

    // Calculate state-level aggregates
    const totalPop = counties.reduce((s, c) => s + c.population, 0);
    const totalHousing = counties.reduce((s, c) => s + c.totalHousingUnits, 0);
    const avgIncome = counties.length > 0
      ? Math.round(counties.reduce((s, c) => s + c.medianIncome, 0) / counties.length)
      : 0;
    const avgHomeValue = counties.length > 0
      ? Math.round(counties.reduce((s, c) => s + c.medianHomeValue, 0) / counties.length)
      : 0;

    // Sort by population desc
    counties.sort((a, b) => b.population - a.population);

    res.json({
      state: state.toUpperCase(),
      stateFips: fips,
      summary: {
        totalPopulation: totalPop,
        totalHousingUnits: totalHousing,
        avgMedianIncome: avgIncome,
        avgMedianHomeValue: avgHomeValue,
        totalCounties: counties.length
      },
      counties: counties.slice(0, 100), // Top 100 by population
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Demographics API error:', err.message);
    res.status(500).json({ error: 'Failed to fetch demographic data' });
  }
};
