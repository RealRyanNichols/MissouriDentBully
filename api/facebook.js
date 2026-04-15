const https = require('https');

const PAGE_TOKEN = process.env.FACEBOOK_PAGE_TOKEN || '';
const PAGE_ID = process.env.FACEBOOK_PAGE_ID || '';
const GRAPH_URL = 'https://graph.facebook.com/v19.0';

function fbAPI(path, method, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(GRAPH_URL + path);
    if (method === 'GET') url.searchParams.set('access_token', PAGE_TOKEN);

    const postData = body ? JSON.stringify(body) : '';
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'HailStrikeOps/1.0'
      }
    };
    if (method === 'POST') {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({ error: data }); }
      });
    });
    req.on('error', reject);
    if (method === 'POST') req.write(postData);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Check if Facebook is configured
  if (!PAGE_TOKEN || !PAGE_ID) {
    return res.json({
      configured: false,
      message: 'Facebook not connected. Add FACEBOOK_PAGE_TOKEN and FACEBOOK_PAGE_ID to Vercel environment variables.',
      setup: {
        step1: 'Go to developers.facebook.com and create an app (or use existing)',
        step2: 'Add Facebook Login and Pages API products',
        step3: 'Go to Tools > Graph API Explorer',
        step4: 'Select your page, request permissions: pages_manage_posts, pages_read_engagement, pages_messaging, ads_management',
        step5: 'Generate Page Access Token (extend to long-lived)',
        step6: 'Add to Vercel: FACEBOOK_PAGE_TOKEN and FACEBOOK_PAGE_ID'
      }
    });
  }

  const { action } = req.query || {};

  try {
    // ── GET ACTIONS ──
    if (req.method === 'GET') {

      // Get page info
      if (action === 'page') {
        const data = await fbAPI(`/${PAGE_ID}?fields=name,fan_count,followers_count,picture,link`, 'GET');
        return res.json({ configured: true, page: data });
      }

      // Get recent posts
      if (action === 'posts') {
        const data = await fbAPI(`/${PAGE_ID}/posts?fields=id,message,created_time,full_picture,permalink_url,shares,likes.summary(true),comments.summary(true)&limit=10`, 'GET');
        return res.json({ configured: true, posts: data.data || [] });
      }

      // Get comments on a post
      if (action === 'comments') {
        const postId = req.query.post_id;
        if (!postId) return res.status(400).json({ error: 'post_id required' });
        const data = await fbAPI(`/${postId}/comments?fields=id,message,from,created_time,like_count&limit=25`, 'GET');
        return res.json({ configured: true, comments: data.data || [] });
      }

      // Get Messenger conversations
      if (action === 'messages') {
        const data = await fbAPI(`/${PAGE_ID}/conversations?fields=id,snippet,updated_time,participants,message_count&limit=15`, 'GET');
        return res.json({ configured: true, conversations: data.data || [] });
      }

      // Get messages in a conversation
      if (action === 'thread') {
        const threadId = req.query.thread_id;
        if (!threadId) return res.status(400).json({ error: 'thread_id required' });
        const data = await fbAPI(`/${threadId}/messages?fields=id,message,from,created_time&limit=20`, 'GET');
        return res.json({ configured: true, messages: data.data || [] });
      }

      // Get page insights
      if (action === 'insights') {
        const data = await fbAPI(`/${PAGE_ID}/insights?metric=page_impressions,page_engaged_users,page_fans&period=day&date_preset=last_7d`, 'GET');
        return res.json({ configured: true, insights: data.data || [] });
      }

      // Default: return status
      return res.json({
        configured: true,
        pageId: PAGE_ID,
        actions: ['page', 'posts', 'comments', 'messages', 'thread', 'insights']
      });
    }

    // ── POST ACTIONS ──
    if (req.method === 'POST') {
      const { type } = req.body || {};

      // Create a post
      if (type === 'post') {
        const { message, link, photo_url } = req.body;
        if (!message) return res.status(400).json({ error: 'message required' });

        let endpoint = `/${PAGE_ID}/feed`;
        let body = { message, access_token: PAGE_TOKEN };
        if (link) body.link = link;

        // If photo, use /photos endpoint
        if (photo_url) {
          endpoint = `/${PAGE_ID}/photos`;
          body.url = photo_url;
          body.caption = message;
          delete body.message;
        }

        const data = await fbAPI(endpoint, 'POST', body);
        return res.json({ success: !data.error, post: data });
      }

      // Reply to a comment
      if (type === 'reply_comment') {
        const { comment_id, message } = req.body;
        if (!comment_id || !message) return res.status(400).json({ error: 'comment_id and message required' });
        const data = await fbAPI(`/${comment_id}/comments`, 'POST', { message, access_token: PAGE_TOKEN });
        return res.json({ success: !data.error, reply: data });
      }

      // Send Messenger reply
      if (type === 'send_message') {
        const { recipient_id, message } = req.body;
        if (!recipient_id || !message) return res.status(400).json({ error: 'recipient_id and message required' });
        const data = await fbAPI(`/${PAGE_ID}/messages`, 'POST', {
          recipient: { id: recipient_id },
          message: { text: message },
          messaging_type: 'RESPONSE',
          access_token: PAGE_TOKEN
        });
        return res.json({ success: !data.error, result: data });
      }

      // Create ad campaign (basic)
      if (type === 'create_ad') {
        const { name, daily_budget, targeting_counties, ad_message } = req.body;
        // This requires an Ad Account ID — return setup instructions for now
        return res.json({
          configured: true,
          note: 'Ad creation requires AD_ACCOUNT_ID. For now, use the targeting data from the Scout tab and create ads manually in Meta Business Suite.',
          suggested: {
            campaign_name: name || 'HailStrike — PDR Campaign',
            objective: 'LEAD_GENERATION',
            daily_budget: daily_budget || '$25',
            targeting: targeting_counties,
            ad_copy: ad_message || 'Hail hit your area? Missouri Dent Bully offers FREE hail damage estimates. We fix dents without repainting. Call/text 636-385-2928'
          }
        });
      }

      return res.status(400).json({ error: 'Unknown action type' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Facebook API error:', err.message);
    res.status(500).json({ error: 'Facebook API request failed' });
  }
};
