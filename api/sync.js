// Vercel serverless function: receives an entry from the app and creates a row
// in the matching Notion database — Deliveries or Inventory, routed by `type`.
// The Notion token lives ONLY here (server-side), never in the client.
//
// Required env var (set in Vercel project settings):
//   NOTION_TOKEN          - your Notion internal integration secret (ntn_... / secret_...)
// Optional env vars (override the defaults below):
//   NOTION_DELIVERIES_DB  - Deliveries database id
//   NOTION_INVENTORY_DB   - Inventory database id
//   APP_KEY               - if set, requests must send a matching "x-app-key" header

// Consolidated onto the original Kairosbaking Deliveries/Inventory databases.
const DB_BY_TYPE = {
  delivery: process.env.NOTION_DELIVERIES_DB || '74476427d7d3831ab84e8107cf70285a',
  inventory: process.env.NOTION_INVENTORY_DB || 'd1576427d7d382568a7b81a8e89c740c',
};

// App product name -> Notion column name.
const PRODUCT_MAP = {
  'Lemon Poppy': 'Lemon Poppy',
  'Sea Salt': 'Sea Salt Butter',
  'Ube': 'Ube',
};

// Allowed locations (must match the Location select options in both databases).
const ALLOWED_LOCATIONS = ['La Mirada', 'Stanton'];

// Coerce an amount to a safe non-negative integer (caps absurd values).
function cleanAmount(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 1000000);
}

// Turn a local wall-clock "YYYY-MM-DDTHH:MM" into a full ISO datetime with the
// correct America/Los_Angeles offset (handles PST -08:00 vs PDT -07:00), so
// Notion stores the date AND time. Returns null if the input is malformed.
function laDateTime(local) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(local))) return null;
  const asUTC = new Date(local + ':00Z');
  const tzName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', timeZoneName: 'longOffset',
  }).formatToParts(asUTC).find((p) => p.type === 'timeZoneName').value; // e.g. "GMT-07:00"
  const m = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  const offset = m ? `${m[1]}${m[2].padStart(2, '0')}:${m[3] || '00'}` : 'Z';
  return `${local}:00${offset}`;
}

// Best-effort phone push via ntfy.sh. Set NTFY_TOPIC in Vercel (a long, private
// name) and subscribe the ntfy app to the same topic. Never blocks/fails the sync.
async function sendNotification({ type, location, dateOnly, amounts }) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const parts = Object.keys(PRODUCT_MAP)
    .map((p) => { const n = cleanAmount(amounts[p]); return n > 0 ? `${p} ${n}` : null; })
    .filter(Boolean);
  const body = `${parts.length ? parts.join(', ') : 'No amounts'} · ${dateOnly}`;
  await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: {
      'Title': `${cap(type)} - ${location}`,        // ASCII only (HTTP header)
      'Tags': type === 'delivery' ? 'truck' : 'package',
    },
    body,
  });
}

export default async function handler(req, res) {
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

    const databaseId = DB_BY_TYPE[String(type).toLowerCase()];
    if (!databaseId) return res.status(400).json({ error: `Unknown type: ${type}` });

    if (!ALLOWED_LOCATIONS.includes(location)) {
      return res.status(400).json({ error: `Unknown location: ${location}` });
    }

    // Store the full date + time (with the right PST/PDT offset).
    const startIso = laDateTime(datetime);
    if (!startIso) return res.status(400).json({ error: `Invalid datetime: ${datetime}` });
    const dateOnly = String(datetime).split('T')[0]; // for the short push text

    const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
    const a = (amounts && typeof amounts === 'object') ? amounts : {};

    const properties = {
      'notes': { title: [{ text: { content: `${cap(type)} — ${location}` } }] },
      'Select': { select: { name: location } },
      'Date': { date: { start: startIso } },
      'Tagged for deletion': { checkbox: false },
    };
    for (const [appName, notionName] of Object.entries(PRODUCT_MAP)) {
      properties[notionName] = { number: cleanAmount(a[appName]) };
    }

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
    if (!r.ok) return res.status(r.status).json({ error: 'Notion API error', detail: data });

    // Push a phone notification (best-effort — a failure here never fails the sync).
    await sendNotification({ type, location, dateOnly, amounts: a }).catch(() => {});

    return res.status(200).json({ ok: true, id: data.id, url: data.url });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
