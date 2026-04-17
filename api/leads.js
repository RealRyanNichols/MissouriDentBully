const { Resend } = require('resend');

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'contact@dentbullyusa.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'HailStrike Ops <onboarding@resend.dev>';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

function escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function buildLeadEmail(lead) {
  var title = lead.type === 'dealership' ? (lead.dealerName || 'Dealership Lead')
            : lead.type === 'storm' ? (lead.area || lead.location || 'Storm Lead')
            : (lead.name || lead.location || 'New Lead');
  var phone = lead.phone || lead.dealerPhone || '';
  var tel = String(phone).replace(/[^\d+]/g, '');

  var row = function(label, value){
    if (!value) return '';
    return '<tr><td style="padding:6px 12px 6px 0;color:#666;font-size:13px;vertical-align:top;">'+escapeHtml(label)+'</td><td style="padding:6px 0;color:#111;font-size:15px;font-weight:500;">'+escapeHtml(value)+'</td></tr>';
  };

  var rows = '';
  if (lead.type === 'storm') {
    rows += row('Area', lead.area || lead.location);
    rows += row('County', lead.county);
    rows += row('State', lead.state);
    rows += row('Storm Event', lead.stormEvent);
    rows += row('Damage', lead.damageType);
    rows += row('Hail Size', lead.hailSize ? lead.hailSize + '"' : '');
    rows += row('Source', lead.source);
  } else if (lead.type === 'customer') {
    rows += row('Name', lead.name);
    rows += row('Phone', lead.phone);
    rows += row('Email', lead.email);
    rows += row('Address', [lead.address, lead.city, lead.state].filter(Boolean).join(', '));
    rows += row('Vehicle', lead.vehicle);
    rows += row('VIN', lead.vin);
    rows += row('Damage', lead.damageType);
    rows += row('Insurance', lead.insurance);
    rows += row('Source', lead.source);
  } else if (lead.type === 'dealership') {
    rows += row('Dealership', lead.dealerName);
    rows += row('Contact', lead.dealerContact);
    rows += row('Phone', lead.dealerPhone);
    rows += row('Email', lead.dealerEmail);
    rows += row('Address', [lead.dealerAddress, lead.dealerCity, lead.dealerState].filter(Boolean).join(', '));
    rows += row('Lot Size', lead.lotSize ? lead.lotSize + ' vehicles' : '');
    rows += row('Type', lead.dealerType);
  } else {
    rows += row('Name', lead.name);
    rows += row('Phone', lead.phone);
    rows += row('Email', lead.email);
    rows += row('Location', [lead.city, lead.state].filter(Boolean).join(', '));
    rows += row('Damage', lead.damageType);
  }

  var callBtn = tel ? '<a href="tel:'+tel+'" style="display:inline-block;background:#0D0D0D;color:#fff;padding:12px 18px;text-decoration:none;font-weight:700;font-size:15px;margin-right:8px;">Call '+escapeHtml(phone)+'</a>' : '';
  var textBtn = tel ? '<a href="sms:'+tel+'" style="display:inline-block;background:#fff;color:#0D0D0D;padding:11px 18px;text-decoration:none;font-weight:700;font-size:15px;border:2px solid #0D0D0D;">Text</a>' : '';

  return '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,sans-serif;">'+
    '<div style="max-width:600px;margin:0 auto;padding:24px 16px;">'+
      '<div style="background:#C0392B;color:#fff;padding:20px 24px;">'+
        '<div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;margin-bottom:4px;">New '+escapeHtml(lead.type||'Lead')+' from HailStrike Ops</div>'+
        '<div style="font-size:22px;font-weight:800;">'+escapeHtml(title)+'</div>'+
      '</div>'+
      '<div style="background:#fff;padding:20px 24px;border:1px solid #eee;">'+
        (callBtn||textBtn?'<div style="margin-bottom:16px;">'+callBtn+textBtn+'</div>':'')+
        '<table style="width:100%;border-collapse:collapse;border-top:1px solid #eee;padding-top:12px;">'+rows+'</table>'+
        (lead.notes?'<div style="margin-top:16px;padding:14px;background:#fafafa;border-left:3px solid #C0392B;"><div style="font-size:12px;color:#666;text-transform:uppercase;margin-bottom:6px;">Notes</div><div style="font-size:15px;color:#111;white-space:pre-wrap;">'+escapeHtml(lead.notes)+'</div></div>':'')+
      '</div>'+
      '<div style="background:#0D0D0D;color:#bbb;padding:14px 24px;font-size:12px;">Submitted '+escapeHtml(lead.createdAt||new Date().toISOString())+' via HailStrike Ops</div>'+
    '</div></body></html>';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const body = req.body || {};
    const lead = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      ...body,
      createdAt: body.createdAt || new Date().toISOString(),
      status: body.status || 'new'
    };

    // Log to Vercel function logs
    console.log('\n===== NEW HAILSTRIKE LEAD =====');
    console.log('Type:    ', lead.type || 'unknown');
    console.log('Title:   ', lead.name || lead.dealerName || lead.area || lead.location);
    console.log('Phone:   ', lead.phone || lead.dealerPhone || '(none)');
    console.log('Damage:  ', lead.damageType || '(none)');
    console.log('Source:  ', lead.source || '(none)');
    console.log('Time:    ', lead.createdAt);
    console.log('===============================\n');

    // Send email if Resend is configured
    if (resend) {
      try {
        const vehicle = lead.vehicle || '';
        const title = lead.dealerName || lead.name || lead.area || lead.location || 'Lead';
        const subject = 'HailStrike: ' + title + (lead.damageType ? ' — ' + lead.damageType : '');

        const result = await resend.emails.send({
          from: FROM_EMAIL,
          to: NOTIFY_EMAIL.split(',').map(s => s.trim()).filter(Boolean),
          replyTo: lead.email || lead.dealerEmail || undefined,
          subject: subject,
          html: buildLeadEmail(lead)
        });

        if (result.error) {
          console.error('Resend error:', result.error);
          return res.json({ success: true, lead, emailSent: false, error: 'Email delivery failed' });
        }

        console.log('Lead email sent to', NOTIFY_EMAIL);
        return res.json({ success: true, lead, emailSent: true, id: result.data?.id });
      } catch (err) {
        console.error('Lead email error:', err.message);
        return res.json({ success: true, lead, emailSent: false });
      }
    }

    return res.json({ success: true, lead, emailSent: false, note: 'RESEND_API_KEY not configured — email skipped' });
  }

  if (req.method === 'GET') {
    return res.json({
      message: 'Leads stored client-side in localStorage. POST here to send email notification.',
      emailConfigured: !!resend,
      notifyEmail: NOTIFY_EMAIL
    });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
