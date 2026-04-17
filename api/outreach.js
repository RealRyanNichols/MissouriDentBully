const { Resend } = require('resend');

const FROM_EMAIL = process.env.FROM_EMAIL || 'Missouri Dent Bully <onboarding@resend.dev>';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// ─── Templates ───────────────────────────────────────────
const SMS_TEMPLATES = {
  pdr_hail_initial: {
    name: 'PDR Hail — First Contact',
    message: "Hey {{name}}! Hail just hit {{area}} and vehicles in your area likely took damage. Missouri Dent Bully offers FREE hail damage estimates — we fix dents without repainting, same-day service. Text or call Jason: 636-385-2928. We come to you!",
    variables: ['name', 'area']
  },
  pdr_hail_followup: {
    name: 'PDR Hail — Follow Up',
    message: "{{name}}, just checking in — did your vehicle get hit in the {{area}} hail storm? Most people don't notice hail damage until they look closely. FREE inspections, we work with your insurance. 636-385-2928.",
    variables: ['name', 'area']
  },
  pdr_insurance: {
    name: 'PDR — Insurance Reminder',
    message: "{{name}}, quick reminder — hail damage claims have a time limit. Missouri Dent Bully handles everything with your insurance. You pay only the deductible. 30+ years experience. 636-385-2928",
    variables: ['name']
  },
  roof_hail: {
    name: 'Roofing — Hail Damage',
    message: "{{name}}, the hail storm in {{area}} may have damaged your roof. Our partner roofing team offers FREE inspections and works with your insurance. Reply YES for estimate. 636-385-2928",
    variables: ['name', 'area']
  },
  pickup_reminder: {
    name: 'Pickup Reminder',
    message: "Hey {{name}}, this is Jason at Missouri Dent Bully. Your vehicle is ready for pickup — 960 N. Commercial Ave, Saint Clair. Give me a shout when you're on your way. 636-385-2928",
    variables: ['name']
  }
};

const EMAIL_TEMPLATES = {
  pdr_hail_initial: {
    name: 'PDR Hail — First Contact',
    subject: 'Your vehicle may have hail damage — FREE estimate from Missouri Dent Bully',
    body: `Hi {{name}},

A confirmed hail storm just hit {{area}}, with hail up to {{size}} inches reported. Vehicles in your area likely sustained dent damage.

Missouri Dent Bully specializes in Paintless Dent Repair (PDR) — we remove hail dents WITHOUT repainting, preserving your factory finish. Most repairs are same-day.

WHAT WE OFFER:
• FREE hail damage estimate
• We work with ALL insurance companies
• You typically pay only your deductible
• Mobile service — we come to you
• Doesn't show on Carfax
• 30+ years experience | 5.0 Google rating

Call or text Jason: 636-385-2928
Email: contact@dentbullyusa.com
Website: dentbullyusa.com

— Missouri Dent Bully
960 N. Commercial Ave, Saint Clair, MO 63077`,
    variables: ['name', 'area', 'size']
  },
  pdr_hail_followup: {
    name: 'PDR Hail — Follow Up',
    subject: "Don't miss your hail damage claim window — {{name}}",
    body: `Hi {{name}},

Just following up on the recent hail event in {{area}}. Many vehicle owners don't realize their car has hail damage until it's pointed out — small dents are easy to miss but they add up.

Here's why you should get a FREE inspection now:
• Insurance claims have deadlines — don't miss yours
• We handle the entire claim process for you
• PDR preserves your factory paint — no body filler, no repainting
• Most repairs completed same-day
• We come to your home or work

Schedule your FREE estimate:
Call/Text: 636-385-2928

— Jason & Laura
Missouri Dent Bully`,
    variables: ['name', 'area']
  },
  estimate_sent: {
    name: 'Estimate Sent',
    subject: 'Your Missouri Dent Bully estimate',
    body: `Hi {{name}},

Your hail damage estimate is attached. A few things to note:

• This estimate is FREE and no-obligation
• We work directly with {{carrier}} — no hassle for you
• You typically pay only your deductible
• Most repairs are same-day

When you're ready to schedule, just reply to this email or text/call 636-385-2928.

— Jason
Missouri Dent Bully`,
    variables: ['name', 'carrier']
  }
};

function renderTemplate(str, vars) {
  return String(str || '').replace(/\{\{(\w+)\}\}/g, function(_, k) {
    return vars[k] || '';
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: Return all templates ──
  if (req.method === 'GET') {
    return res.json({
      templates: { sms: SMS_TEMPLATES, email: EMAIL_TEMPLATES },
      integrations: {
        email: { provider: 'resend', status: resend ? 'connected' : 'not_configured' },
        sms: { provider: 'twilio', status: process.env.TWILIO_SID ? 'connected' : 'not_configured' }
      }
    });
  }

  // ── POST: Send single message or campaign ──
  if (req.method === 'POST') {
    const body = req.body || {};
    const { type, template, to, variables, customMessage, customSubject, recipients, stormEvent } = body;

    // Single send
    if (type === 'email' && to) {
      if (!resend) {
        return res.json({ success: false, error: 'RESEND_API_KEY not set. Add it in Vercel environment variables.' });
      }
      const tmpl = EMAIL_TEMPLATES[template];
      const vars = variables || {};
      const subject = customSubject || (tmpl ? renderTemplate(tmpl.subject, vars) : 'Message from Missouri Dent Bully');
      const bodyText = customMessage || (tmpl ? renderTemplate(tmpl.body, vars) : '');

      try {
        const result = await resend.emails.send({
          from: FROM_EMAIL,
          to: Array.isArray(to) ? to : [to],
          subject,
          text: bodyText,
          replyTo: process.env.NOTIFY_EMAIL || 'contact@dentbullyusa.com'
        });
        if (result.error) return res.status(500).json({ success: false, error: result.error.message });
        return res.json({ success: true, id: result.data?.id });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    // Campaign (batch)
    if (type === 'email_campaign') {
      if (!resend) return res.json({ success: false, error: 'RESEND_API_KEY not set' });
      if (!Array.isArray(recipients) || !recipients.length) {
        return res.status(400).json({ error: 'recipients array required' });
      }

      const tmpl = EMAIL_TEMPLATES[template];
      if (!tmpl) return res.status(400).json({ error: 'template not found' });

      const results = { sent: 0, failed: 0, errors: [] };
      // Cap at 50 per campaign to avoid rate limits
      for (const r of recipients.slice(0, 50)) {
        const vars = { name: r.name, area: r.area || stormEvent || '', ...variables };
        try {
          const result = await resend.emails.send({
            from: FROM_EMAIL,
            to: r.email,
            subject: renderTemplate(tmpl.subject, vars),
            text: renderTemplate(tmpl.body, vars)
          });
          if (result.error) { results.failed++; results.errors.push(result.error.message); }
          else results.sent++;
        } catch (err) {
          results.failed++;
          results.errors.push(err.message);
        }
      }

      return res.json({ success: true, ...results });
    }

    // SMS (requires Twilio)
    if (type === 'sms' && to) {
      if (!process.env.TWILIO_SID) {
        return res.json({ success: false, error: 'Twilio not configured. Add TWILIO_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE to Vercel env.' });
      }
      // Twilio send omitted for now — returns setup hint
      return res.json({ success: false, error: 'SMS sending coming soon — use the template text with your phone app for now.' });
    }

    return res.status(400).json({ error: 'Invalid request. Specify type: email, email_campaign, or sms' });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
