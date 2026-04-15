module.exports = function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, phone, damage_type, vehicle, conversation } = req.body || {};

  if (!name || !phone) {
    return res.status(400).json({ error: 'name and phone are required' });
  }

  const lead = {
    name,
    phone,
    damage_type: damage_type || 'Not specified',
    vehicle: vehicle || 'Not specified',
    timestamp: new Date().toISOString()
  };

  console.log('\n===== NEW LEAD =====');
  console.log(`Name:   ${lead.name}`);
  console.log(`Phone:  ${lead.phone}`);
  console.log(`Damage: ${lead.damage_type}`);
  console.log(`Vehicle: ${lead.vehicle}`);
  console.log(`Time:   ${lead.timestamp}`);
  console.log('====================\n');

  res.json({ success: true, message: 'Lead captured' });
};
