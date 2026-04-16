const Anthropic = require('@anthropic-ai/sdk').default;

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
- Paint Correction (2-stage): $900\u2013$1,500
- Paint Correction (3-stage): $1,500\u2013$2,500+
- Ceramic Coating: $500\u2013$2,500
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

const anthropic = new Anthropic();

// Rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 1000;

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (entry && now - entry.windowStart < RATE_WINDOW_MS && entry.count > RATE_LIMIT) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
  } else {
    entry.count++;
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages
    });
    res.json({ reply: response.content[0].text });
  } catch (err) {
    console.error('Chat API error:', err.message);
    res.status(500).json({ error: 'Something went wrong. Give us a call at 636-385-2928.' });
  }
};
