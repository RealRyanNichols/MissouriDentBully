# Dent Bully Chat Widget

AI-powered customer chat widget for **Missouri Dent Bully** — PDR & Reconditioning Specialists.

Uses Claude (claude-sonnet-4-6) as the AI brain to answer customer questions, qualify leads, and drive calls/texts to 636-385-2928.

---

## Quick Start

```bash
cd dent-bully-chat
npm install
cp .env.example .env
# Edit .env and add your Anthropic API key
npm start
```

Visit **http://localhost:3000** to see the demo page with the chat widget.

---

## Environment Variables

| Variable           | Required | Description                          |
|--------------------|----------|--------------------------------------|
| `ANTHROPIC_API_KEY`| Yes      | Your Anthropic API key               |
| `PORT`             | No       | Server port (default: 3000)          |

---

## Embedding on Any Website

Add a single script tag before `</body>`:

```html
<script src="https://your-server-domain.com/widget.js"></script>
```

That's it. The widget injects its own CSS and HTML automatically.

### WordPress

**Option A — Theme Footer:**
1. Go to **Appearance > Theme File Editor**
2. Open `footer.php`
3. Paste the script tag above just before `</body>`

**Option B — Plugin (recommended):**
1. Install the **Insert Headers and Footers** plugin (by WPCode)
2. Go to **Code Snippets > Header & Footer**
3. Paste the script tag in the **Footer** section
4. Save

---

## API Endpoints

### `POST /api/chat`

Send a conversation to the AI assistant.

**Request:**
```json
{
  "messages": [
    { "role": "user", "content": "I have a dent in my truck door" }
  ]
}
```

**Response:**
```json
{
  "reply": "That's exactly what we do. What year, make, and model..."
}
```

### `POST /api/lead`

Submit a captured lead.

**Request:**
```json
{
  "name": "John Smith",
  "phone": "555-123-4567",
  "damage_type": "hail damage",
  "vehicle": "2021 Ford F-150"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Lead captured"
}
```

---

## Deployment

### Railway

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) and create a new project
3. Connect your GitHub repo
4. Set the **Root Directory** to `dent-bully-chat`
5. Add environment variable: `ANTHROPIC_API_KEY`
6. Deploy — Railway provides HTTPS automatically
7. Use the provided domain in your widget script tag

### Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) and create a new **Web Service**
3. Connect your GitHub repo
4. Set **Root Directory** to `dent-bully-chat`
5. Set **Build Command** to `npm install`
6. Set **Start Command** to `node server.js`
7. Add environment variable: `ANTHROPIC_API_KEY`
8. Deploy

### Vercel

> Note: Vercel is optimized for serverless. For this Express app, Railway or Render are recommended.

1. Install the Vercel CLI: `npm i -g vercel`
2. Add a `vercel.json` in the `dent-bully-chat` directory:
   ```json
   {
     "builds": [{ "src": "server.js", "use": "@vercel/node" }],
     "routes": [{ "src": "/(.*)", "dest": "server.js" }]
   }
   ```
3. Run `vercel` and follow the prompts
4. Set `ANTHROPIC_API_KEY` in the Vercel dashboard

---

## File Structure

```
dent-bully-chat/
  ├── public/
  │   └── index.html      ← Demo landing page
  ├── widget.js            ← Embeddable chat widget (single script tag)
  ├── widget.css           ← Widget styles (development reference)
  ├── server.js            ← Express server + API endpoints
  ├── package.json         ← Dependencies
  ├── .env.example         ← Environment variable template
  ├── .gitignore           ← Ignores node_modules, .env, leads.json
  └── README.md            ← This file
```

---

## Features

- **AI-powered chat** — Claude answers questions about PDR, detailing, hail repair, pricing, and insurance
- **Lead capture** — Automatically detects name, phone, vehicle, and damage type from conversation
- **localStorage persistence** — Conversation survives page refreshes (24-hour TTL)
- **Single script tag embed** — Works on any website including WordPress
- **Mobile responsive** — Full-screen chat on mobile devices
- **Rate limiting** — 20 requests per minute per IP
- **Dark industrial theme** — Matches the Dent Bully brand

---

## Lead Storage

Captured leads are:
1. Logged to the server console
2. Saved to `leads.json` in the project root
3. Stored in the browser's localStorage

To integrate with a CRM (HubSpot, GoHighLevel, etc.), modify the `POST /api/lead` handler in `server.js`.
