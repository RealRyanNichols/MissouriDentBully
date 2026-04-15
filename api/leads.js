module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // For MVP, leads are stored client-side in localStorage
  // This endpoint handles lead operations for future database integration

  if (req.method === 'POST') {
    const { name, phone, email, address, city, state, zip, damageType, stormEvent, vehicleInfo, propertyType, notes, source } = req.body || {};

    if (!name && !phone && !address) {
      return res.status(400).json({ error: 'At least name, phone, or address is required' });
    }

    const lead = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      name: name || '',
      phone: phone || '',
      email: email || '',
      address: address || '',
      city: city || '',
      state: state || '',
      zip: zip || '',
      damageType: damageType || 'unknown', // auto, roof, solar, glass, gutter
      stormEvent: stormEvent || '',
      vehicleInfo: vehicleInfo || '',
      propertyType: propertyType || '', // residential, commercial, dealership, fleet
      notes: notes || '',
      source: source || 'hailstrike',
      status: 'new', // new, contacted, qualified, scheduled, completed, lost
      priority: 'medium',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Auto-set priority based on damage type
    if (damageType === 'auto' || damageType === 'roof') lead.priority = 'high';
    if (damageType === 'fleet') lead.priority = 'urgent';

    console.log('\n===== NEW HAILSTRIKE LEAD =====');
    console.log(`ID:       ${lead.id}`);
    console.log(`Name:     ${lead.name}`);
    console.log(`Phone:    ${lead.phone}`);
    console.log(`Email:    ${lead.email}`);
    console.log(`Address:  ${lead.address}, ${lead.city}, ${lead.state} ${lead.zip}`);
    console.log(`Damage:   ${lead.damageType}`);
    console.log(`Property: ${lead.propertyType}`);
    console.log(`Storm:    ${lead.stormEvent}`);
    console.log(`Priority: ${lead.priority}`);
    console.log('================================\n');

    return res.json({ success: true, lead });
  }

  if (req.method === 'GET') {
    // Future: query leads from database
    return res.json({
      message: 'Leads are currently stored client-side. Database integration coming soon.',
      schema: {
        fields: ['id', 'name', 'phone', 'email', 'address', 'city', 'state', 'zip',
                 'damageType', 'stormEvent', 'vehicleInfo', 'propertyType', 'notes',
                 'source', 'status', 'priority', 'createdAt', 'updatedAt'],
        damageTypes: ['auto', 'roof', 'solar', 'glass', 'gutter', 'fleet', 'other'],
        statuses: ['new', 'contacted', 'qualified', 'scheduled', 'completed', 'lost'],
        priorities: ['low', 'medium', 'high', 'urgent']
      }
    });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
