const { Resend } = require('resend');

// ── Config ──
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'contact@dentbullyusa.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Missouri Dent Bully <onboarding@resend.dev>';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// ── Rate limit: 5 submissions per IP per 5 min ──
const rateLimitMap = new Map();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 5 * 60 * 1000;

function checkRate(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ── Helpers ──
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPhoneForTel(phone) {
  return String(phone || '').replace(/[^\d+]/g, '');
}

function buildEmailHtml(lead) {
  const vehicle = [lead.year, lead.make, lead.model].filter(Boolean).join(' ');
  const tel = formatPhoneForTel(lead.phone);
  const smsBody = encodeURIComponent(`Hey ${lead.name || 'there'}, this is Jason at Missouri Dent Bully returning your call. Got a minute?`);

  const row = (label, value) => value
    ? `<tr><td style="padding:6px 12px 6px 0;color:#666;font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#111;font-size:15px;font-weight:500;">${escapeHtml(value)}</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;">

  <div style="background:#C0392B;color:#fff;padding:20px 24px;">
    <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;margin-bottom:4px;">New Lead</div>
    <div style="font-size:22px;font-weight:800;">${escapeHtml(lead.name || 'Unnamed')} — ${escapeHtml(lead.damage_type || 'damage')}</div>
    <div style="font-size:14px;opacity:0.9;margin-top:4px;">${escapeHtml(vehicle || 'vehicle TBD')}</div>
  </div>

  <div style="background:#fff;padding:20px 24px;border-left:2px solid #eee;border-right:2px solid #eee;">
    <div style="display:block;margin-bottom:16px;">
      <a href="tel:${tel}" style="display:inline-block;background:#0D0D0D;color:#fff;padding:12px 18px;text-decoration:none;font-weight:700;font-size:15px;margin-right:8px;">Call ${escapeHtml(lead.phone || '')}</a>
      ${tel ? `<a href="sms:${tel}?body=${smsBody}" style="display:inline-block;background:#fff;color:#0D0D0D;padding:11px 18px;text-decoration:none;font-weight:700;font-size:15px;border:2px solid #0D0D0D;">Text</a>` : ''}
    </div>

    <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee;padding-top:12px;">
      ${row('Name', lead.name)}
      ${row('Phone', lead.phone)}
      ${row('Email', lead.email)}
      ${row('Vehicle', vehicle)}
      ${row('VIN', lead.vin)}
      ${row('Damage', lead.damage_type)}
      ${row('Carrier', lead.carrier)}
      ${row('Claim #', lead.claim)}
      ${row('Source', lead.source)}
      ${row('Contact via', lead.preferred_contact)}
      ${row('Photos', `${lead.photos ? lead.photos.length : 0} attached`)}
    </table>

    ${lead.notes ? `<div style="margin-top:16px;padding:14px;background:#fafafa;border-left:3px solid #C0392B;">
      <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Notes</div>
      <div style="font-size:15px;color:#111;white-space:pre-wrap;">${escapeHtml(lead.notes)}</div>
    </div>` : ''}
  </div>

  <div style="background:#0D0D0D;color:#bbb;padding:14px 24px;font-size:12px;">
    Submitted ${escapeHtml(lead.submitted_at)} from ${escapeHtml(lead.ip || 'unknown IP')}
  </div>

</div></body></html>`;
}

function buildEmailText(lead) {
  const vehicle = [lead.year, lead.make, lead.model].filter(Boolean).join(' ');
  const lines = [
    `NEW LEAD — ${lead.name || 'Unnamed'}`,
    '',
    `Phone: ${lead.phone || '(none)'}`,
    `Email: ${lead.email || '(none)'}`,
    `Vehicle: ${vehicle || '(TBD)'}`,
    lead.vin ? `VIN: ${lead.vin}` : null,
    `Damage: ${lead.damage_type || '(TBD)'}`,
    lead.carrier ? `Carrier: ${lead.carrier}` : null,
    lead.claim ? `Claim #: ${lead.claim}` : null,
    lead.source ? `Source: ${lead.source}` : null,
    lead.preferred_contact ? `Contact via: ${lead.preferred_contact}` : null,
    `Photos: ${lead.photos ? lead.photos.length : 0} attached`,
    '',
    lead.notes ? `Notes:\n${lead.notes}` : null,
    '',
    `Submitted ${lead.submitted_at}`
  ];
  return lines.filter(Boolean).join('\n');
}

// ── Handler ──
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (!checkRate(ip)) {
    return res.status(429).json({ error: 'Too many submissions. Please call 636-385-2928.' });
  }

  const body = req.body || {};
  const { name, phone, email, year, make, model, vin, damage_type, carrier, claim, source, preferred_contact, notes, photos } = body;

  // Validate
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone are required.' });
  }
  if (String(phone).replace(/\D/g, '').length < 10) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }

  // Cap photo payload to prevent abuse / Vercel 4.5MB body limit
  const safePhotos = Array.isArray(photos) ? photos.slice(0, 10) : [];

  const lead = {
    name, phone, email, year, make, model, vin,
    damage_type, carrier, claim, source, preferred_contact, notes,
    photos: safePhotos,
    ip,
    submitted_at: new Date().toISOString()
  };

  // Always log to Vercel function logs so Ryan has a paper trail
  console.log('\n===== NEW INTAKE =====');
  console.log(`Name:      ${lead.name}`);
  console.log(`Phone:     ${lead.phone}`);
  console.log(`Email:     ${lead.email || '(none)'}`);
  console.log(`Vehicle:   ${lead.year} ${lead.make} ${lead.model}`);
  console.log(`VIN:       ${lead.vin || '(none)'}`);
  console.log(`Damage:    ${lead.damage_type}`);
  console.log(`Carrier:   ${lead.carrier || '(none)'}`);
  console.log(`Claim:     ${lead.claim || '(none)'}`);
  console.log(`Source:    ${lead.source || '(none)'}`);
  console.log(`Contact:   ${lead.preferred_contact || '(none)'}`);
  console.log(`Photos:    ${safePhotos.length}`);
  console.log(`Notes:     ${lead.notes || '(none)'}`);
  console.log(`IP:        ${ip}`);
  console.log(`Time:      ${lead.submitted_at}`);
  console.log('======================\n');

  // Graceful degradation: if Resend isn't configured, still return 200 so the form works
  if (!resend) {
    console.warn('RESEND_API_KEY not set — lead logged but no email sent.');
    return res.json({
      success: true,
      message: 'Lead received (email delivery pending setup).',
      emailSent: false
    });
  }

  // Build attachments from base64 data
  const attachments = safePhotos
    .filter(p => p && p.data)
    .map((p, i) => ({
      filename: p.name || `photo-${i + 1}.jpg`,
      content: p.data,  // Resend accepts base64 strings directly
    }));

  const vehicleStr = [year, make, model].filter(Boolean).join(' ') || 'vehicle TBD';
  const subject = `Lead: ${name} — ${damage_type || 'damage'} — ${vehicleStr}`;

  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL.split(',').map(s => s.trim()).filter(Boolean),
      replyTo: email || undefined,
      subject,
      html: buildEmailHtml(lead),
      text: buildEmailText(lead),
      attachments
    });

    if (result.error) {
      console.error('Resend error:', result.error);
      return res.status(500).json({
        success: false,
        error: 'Lead received but email delivery failed. Jason will still see it in Vercel logs.',
        emailSent: false
      });
    }

    console.log(`Email sent to ${NOTIFY_EMAIL} — Resend id: ${result.data?.id}`);
    return res.json({ success: true, message: 'Lead sent to Jason.', emailSent: true, id: result.data?.id });
  } catch (err) {
    console.error('Intake handler error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Lead received but email delivery failed. Call 636-385-2928 to confirm.',
      emailSent: false
    });
  }
};
