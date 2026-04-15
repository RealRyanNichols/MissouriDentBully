require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk').default;
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files — public/ for index.html, root for widget.js/widget.css
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// ---------------------------------------------------------------------------
// Rate limiting (simple in-memory, per-IP, 20 requests/min)
// ---------------------------------------------------------------------------
const rateLimitMap = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 1000;

function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }
  next();
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_WINDOW_MS) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are the AI assistant for Missouri Dent Bully, a premier Paintless Dent Repair and Automotive Reconditioning company based in Saint Clair, MO (dentbullyusa.com).

BUSINESS INFO:
- Phone/Text: 636-385-2928 (Jason & Laura)
- Email: contact@dentbullyusa.com
- Address: 960 N. Commercial Ave, Saint Clair, MO 63077
- Hours: By Appointment
- Service Area: All of Missouri + IA, AR, OK, KS, IL, TN, KY, IN for storm events

SERVICES:
- Paintless Dent Repair (PDR): Removes dents/dings/creases/hail without repainting. Preserves factory finish. Most repairs same-day. Pricing by estimate only — always free.
- Hail Damage Repair: Free estimates. Work directly with ALL insurance companies. Customer typically pays only deductible.
- Auto Detailing:
  Full Interior: Car $150 / Truck $200 / SUV $225 / Large Van $250 / Large SUV $275
  Full Exterior: Car $150 / Truck $200 / SUV $225 / Large Van $250 / Large SUV $275
  Full Detail (both): Car $275 / Truck $350 / SUV $400 / Large Van $450 / Large SUV $500
  VIP Refresh (last 2 weeks only): Car $75 / Truck $90 / Van or SUV $100 / Large $115
- Paint Correction (2-stage): $900–$1,500
- Paint Correction (3-stage): $1,500–$2,500+
- Ceramic Coating: $500–$2,500
- Dealership/Fleet Services: Call for pricing

KEY FACTS:
- 30+ years of automotive experience
- 5.0 Google Rating
- Mobile service available — we come to you
- Insurance claims handled start to finish — zero hassle
- PDR does NOT show on Carfax / vehicle history
- Factory paint preserved — no filler, no sanding, no repainting
- Satisfaction guaranteed

YOUR JOB:
1. Answer questions honestly and confidently
2. Naturally collect lead info: name, phone, vehicle (year/make/model), damage type
3. NEVER guess PDR prices — always direct to free estimate via call/text to 636-385-2928
4. Detailing prices CAN and SHOULD be quoted directly from the pricing above
5. Always close with a CTA to call or text 636-385-2928
6. Sound like a confident, straight-talking local — not a corporate script
7. Keep responses concise — 2-4 sentences max unless the customer asks for details

TONE: Direct, warm, trustworthy. A little tough-guy Missouri grit without being rude.`;

// ---------------------------------------------------------------------------
// Anthropic client
// ---------------------------------------------------------------------------
const anthropic = new Anthropic();

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------
app.post('/api/chat', rateLimit, async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages
    });

    res.json({ reply: response.content[0].text });
  } catch (err) {
    console.error('Chat API error:', err.message);
    res.status(500).json({ error: 'Something went wrong. Give us a call at 636-385-2928.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/lead
// ---------------------------------------------------------------------------
app.post('/api/lead', (req, res) => {
  const { name, phone, damage_type, vehicle, conversation } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'name and phone are required' });
  }

  const lead = {
    name,
    phone,
    damage_type: damage_type || 'Not specified',
    vehicle: vehicle || 'Not specified',
    timestamp: new Date().toISOString(),
    conversation: conversation || []
  };

  console.log('\n===== NEW LEAD =====');
  console.log(`Name:   ${lead.name}`);
  console.log(`Phone:  ${lead.phone}`);
  console.log(`Damage: ${lead.damage_type}`);
  console.log(`Vehicle: ${lead.vehicle}`);
  console.log(`Time:   ${lead.timestamp}`);
  console.log('====================\n');

  // Append to leads.json for simple persistence
  const leadsFile = path.join(__dirname, 'leads.json');
  try {
    let leads = [];
    if (fs.existsSync(leadsFile)) {
      leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
    }
    leads.push(lead);
    fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));
  } catch (err) {
    console.error('Failed to write lead to file:', err.message);
  }

  res.json({ success: true, message: 'Lead captured' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dent Bully chat server running on port ${PORT}`);
});
