module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: Return message templates ──
  if (req.method === 'GET') {
    return res.json({
      templates: {
        sms: {
          pdr_hail_initial: {
            name: 'PDR Hail — First Contact',
            message: "Hey {{name}}! A hail storm just hit {{area}} and vehicles in your area likely took damage. Missouri Dent Bully offers FREE hail damage estimates — we fix dents without repainting, same-day service. Text or call Jason: 636-385-2928. We come to you!",
            variables: ['name', 'area']
          },
          pdr_hail_followup: {
            name: 'PDR Hail — Follow Up',
            message: "{{name}}, just checking in — did your vehicle get hit in the {{area}} hail storm? Most people don't realize hail damage until they look closely. We do FREE inspections and work directly with your insurance. Zero hassle. Call/text 636-385-2928.",
            variables: ['name', 'area']
          },
          pdr_insurance: {
            name: 'PDR — Insurance Reminder',
            message: "Quick reminder {{name}} — hail damage claims have a time limit. Missouri Dent Bully handles everything with your insurance company. You typically just pay the deductible. 30+ years experience, 5.0 Google rating. 636-385-2928",
            variables: ['name']
          },
          roof_hail: {
            name: 'Roofing — Hail Damage',
            message: "{{name}}, the recent hail storm in {{area}} may have damaged your roof. Our partner roofing team offers FREE inspections and works with your insurance. Don't wait — water damage adds up fast. Reply YES for a free estimate.",
            variables: ['name', 'area']
          },
          solar_hail: {
            name: 'Solar — Panel Damage',
            message: "{{name}}, hail in {{area}} can crack solar panels and kill your energy production. Free inspection available through our partner network. Reply for details.",
            variables: ['name', 'area']
          }
        },
        email: {
          pdr_hail_initial: {
            name: 'PDR Hail — First Contact',
            subject: 'Your vehicle may have hail damage — FREE estimate from Missouri Dent Bully',
            body: "Hi {{name}},\n\nA confirmed hail storm just hit {{area}} on {{date}}, with hail up to {{size}} inches reported. Vehicles in your area likely sustained dent damage.\n\nMissouri Dent Bully specializes in Paintless Dent Repair (PDR) — we remove hail dents WITHOUT repainting, preserving your factory finish. Most repairs are same-day.\n\nWHAT WE OFFER:\n• FREE hail damage estimate\n• We work with ALL insurance companies\n• You typically pay only your deductible\n• Mobile service — we come to you\n• Doesn't show on Carfax\n• 30+ years experience | 5.0 Google rating\n\nCall or text Jason: 636-385-2928\nEmail: contact@dentbullyusa.com\nWebsite: dentbullyusa.com\n\n— Missouri Dent Bully\n960 N. Commercial Ave, Saint Clair, MO 63077",
            variables: ['name', 'area', 'date', 'size']
          },
          pdr_hail_followup: {
            name: 'PDR Hail — Follow Up',
            subject: "Don't miss your hail damage claim window — {{name}}",
            body: "Hi {{name}},\n\nJust following up on the recent hail event in {{area}}. Many vehicle owners don't realize their car has hail damage until it's pointed out — small dents are easy to miss but they add up.\n\nHere's why you should get a FREE inspection now:\n• Insurance claims have deadlines — don't miss yours\n• We handle the entire claim process for you\n• PDR preserves your factory paint — no body filler, no repainting\n• Most repairs completed same-day\n• We come to your home or work\n\nSchedule your FREE estimate:\nCall/Text: 636-385-2928\n\n— Jason & Laura\nMissouri Dent Bully",
            variables: ['name', 'area']
          }
        }
      },
      integrations: {
        sms: {
          provider: 'twilio',
          status: process.env.TWILIO_SID ? 'connected' : 'not_configured',
          setup: 'Add TWILIO_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE to environment variables'
        },
        email: {
          provider: 'sendgrid',
          status: process.env.SENDGRID_API_KEY ? 'connected' : 'not_configured',
          setup: 'Add SENDGRID_API_KEY and FROM_EMAIL to environment variables'
        }
      },
      stats: {
        note: 'Campaign stats will be tracked once SMS/email integrations are connected'
      }
    });
  }

  // ── POST: Queue/send outreach campaign ──
  if (req.method === 'POST') {
    const { type, template, recipients, customMessage, stormEvent } = req.body || {};

    if (!type || !recipients || !recipients.length) {
      return res.status(400).json({ error: 'type and recipients array required' });
    }

    const campaign = {
      id: 'camp_' + Date.now().toString(36),
      type, // 'sms' or 'email'
      template: template || 'custom',
      recipientCount: recipients.length,
      stormEvent: stormEvent || '',
      status: 'queued',
      createdAt: new Date().toISOString(),
      results: { sent: 0, failed: 0, pending: recipients.length }
    };

    // Log campaign
    console.log('\n===== OUTREACH CAMPAIGN =====');
    console.log(`ID:         ${campaign.id}`);
    console.log(`Type:       ${campaign.type}`);
    console.log(`Template:   ${campaign.template}`);
    console.log(`Recipients: ${campaign.recipientCount}`);
    console.log(`Storm:      ${campaign.stormEvent}`);
    console.log('=============================\n');

    // Check if integrations are configured
    if (type === 'sms' && !process.env.TWILIO_SID) {
      campaign.status = 'pending_setup';
      campaign.note = 'Twilio not configured. Add TWILIO_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE to env vars.';
      return res.json({ campaign });
    }

    if (type === 'email' && !process.env.SENDGRID_API_KEY) {
      campaign.status = 'pending_setup';
      campaign.note = 'SendGrid not configured. Add SENDGRID_API_KEY and FROM_EMAIL to env vars.';
      return res.json({ campaign });
    }

    // If Twilio is configured, actually send SMS
    if (type === 'sms' && process.env.TWILIO_SID) {
      try {
        const accountSid = process.env.TWILIO_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const fromPhone = process.env.TWILIO_PHONE;
        const https = require('https');

        for (const recipient of recipients.slice(0, 50)) { // Cap at 50 per campaign
          const msg = (customMessage || '').replace(/\{\{name\}\}/g, recipient.name || 'there')
            .replace(/\{\{area\}\}/g, stormEvent || 'your area');

          const postData = new URLSearchParams({
            To: recipient.phone,
            From: fromPhone,
            Body: msg
          }).toString();

          await new Promise((resolve, reject) => {
            const options = {
              hostname: 'api.twilio.com',
              path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
              method: 'POST',
              auth: `${accountSid}:${authToken}`,
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': postData.length }
            };
            const r = https.request(options, (resp) => {
              let d = '';
              resp.on('data', c => d += c);
              resp.on('end', () => {
                if (resp.statusCode < 300) { campaign.results.sent++; }
                else { campaign.results.failed++; console.error('SMS failed:', d); }
                campaign.results.pending--;
                resolve();
              });
            });
            r.on('error', (e) => { campaign.results.failed++; campaign.results.pending--; resolve(); });
            r.write(postData);
            r.end();
          });
        }
        campaign.status = 'completed';
      } catch (e) {
        console.error('SMS send error:', e.message);
        campaign.status = 'error';
        campaign.error = e.message;
      }
    }

    return res.json({ campaign });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
