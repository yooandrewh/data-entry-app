// Vercel serverless function: receives an entry from the app and creates a row
// in the Notion "Sales" database. The Notion token lives ONLY here (server-side),
// never in the client.
//
// Required env var (set in Vercel project settings):
//   NOTION_TOKEN          - your Notion internal integration secret (ntn_... / secret_...)
// Optional env vars:
//   NOTION_DATABASE_ID    - defaults to the Sales database id below
//   APP_KEY               - if set, requests must send a matching "x-app-key" header

const DEFAULT_DATABASE_ID = '46376427d7d383bf97240131fa5eda73'; // Sales

// App product name -> Notion column name. Matcha/Chocolate stay 0 (not in app).
const PRODUCT_MAP = {
  'Lemon Poppy': 'Lemon Poppy',
  'Sea Salt': 'Sea Salt Butter',
  'Ube': 'Ube',
};

export default async function handler(req, res) {
  // CORS — allow the GitHub Pages site (or any origin) to call this endpoint.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'Server is missing NOTION_TOKEN' });

  if (process.env.APP_KEY && req.headers['x-app-key'] !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { type, datetime, location, amounts } = req.body || {};
    if (!type || !location || !datetime) {
      return res.status(400).json({ error: 'Missing required fields (type, datetime, location)' });
    }

    const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
    const a = amounts || {};
    const typeLabel = cap(type);                 // "Delivery" | "Inventory"
    const dateOnly = String(datetime).split('T')[0]; // "YYYY-MM-DD" (matches DB date display)

    const properties = {
      'notes': { title: [{ text: { content: `${typeLabel} — ${location}` } }] },
      'Type': { select: { name: typeLabel } },
      'Select': { select: { name: location } },
      'Date': { date: { start: dateOnly } },
    };
    for (const [appName, notionName] of Object.entries(PRODUCT_MAP)) {
      properties[notionName] = { number: Number(a[appName]) || 0 };
    }

    const databaseId = process.env.NOTION_DATABASE_ID || DEFAULT_DATABASE_ID;
    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: 'Notion API error', detail: data });
    }
    return res.status(200).json({ ok: true, id: data.id, url: data.url });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
