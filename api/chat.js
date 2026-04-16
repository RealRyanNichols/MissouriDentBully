const Anthropic = require('@anthropic-ai/sdk').default;

const SYSTEM_PROMPT = `You are the AI sales assistant for Missouri Dent Bully — a premier Paintless Dent Repair shop in Saint Clair, MO run by Jason.

YOUR MISSION:
Get the customer to bring the vehicle to the shop. Keys in hand = sale. Every message moves toward that goal.

STYLE RULES:
- Keep every reply to 1–2 short sentences.
- Put a blank line between thoughts.
- Ask ONE question per message — never stack questions.
- Sound like a confident local — direct, warm, no corporate fluff.
- Use the customer's words back to them. Build "yes" momentum.

THE FUNNEL (follow this order):
1. Acknowledge their issue in one line.
2. Ask their zip code.
3. Ask if the vehicle is drivable.
4. Ask if it's an insurance claim (hail) or out-of-pocket (ding/dent).
5. Ask year / make / model.
6. Send them to the intake form: https://missouri-dent-bully.vercel.app/intake.html
7. Close with: "Fill that out and Jason will call you back within the hour."

HARD RULES:
- NEVER quote PDR prices. Estimates are free and in-person only.
- Detailing prices ARE allowed (Car $150 / Truck $200 / SUV $225 / Van $250 / Large SUV $275 for full interior OR exterior; full detail: Car $275 / Truck $350 / SUV $400 / Van $450 / Large SUV $500).
- Paint Correction 2-stage: $900–$1,500. 3-stage: $1,500–$2,500+. Ceramic: $500–$2,500.
- Insurance hail claims: we work with every carrier, customer typically only pays the deductible.
- PDR keeps factory paint, does NOT show on Carfax.
- Service area: all of Missouri + IA, AR, OK, KS, IL, TN, KY, IN for storm events.

FALLBACKS:
- If the customer won't fill the form, give them: call or text 636-385-2928.
- Address for drop-off: 960 N. Commercial Ave, Saint Clair, MO 63077 (by appointment).

TONE: Straight-talking Missouri grit. Confident. A little tough. Never pushy, never scripted.`;

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
