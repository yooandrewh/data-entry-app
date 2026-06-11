// Vercel serverless function: marks a Notion row's "Tagged for deletion" checkbox.
// Nothing is actually deleted — the row stays in Notion, flagged for review.
//
// Body: { pageId: "<notion page id>", tagged?: true }
// Required env var: NOTION_TOKEN   (optional: APP_KEY — same as sync.js)
//
// Safety: only pages that live in the Deliveries/Inventory databases can be
// tagged, so this endpoint can't be used to flag arbitrary pages elsewhere.

const ALLOWED_DBS = [
  process.env.NOTION_DELIVERIES_DB || '9600856eb32c44a99771dbec4acbcb5a',
  process.env.NOTION_INVENTORY_DB || '7dc1fbfd6bed47539a7844eecc7e06f8',
].map((id) => id.replace(/-/g, ''));

const NOTION_HEADERS = (token) => ({
  'Authorization': `Bearer ${token}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
});

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
    const { pageId, tagged } = req.body || {};
    if (!pageId || typeof pageId !== 'string') {
      return res.status(400).json({ error: 'Missing pageId' });
    }
    // Accept only a UUID (with or without dashes) to avoid path injection.
    if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(pageId)) {
      return res.status(400).json({ error: 'Invalid pageId' });
    }

    // Verify the page belongs to one of our databases before modifying it.
    const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: NOTION_HEADERS(token),
    });
    const page = await pageRes.json();
    if (!pageRes.ok) return res.status(pageRes.status).json({ error: 'Notion API error', detail: page });

    const parentDb = (page.parent && page.parent.database_id || '').replace(/-/g, '');
    if (!ALLOWED_DBS.includes(parentDb)) {
      return res.status(403).json({ error: 'Page is not in a managed database' });
    }

    const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: NOTION_HEADERS(token),
      body: JSON.stringify({
        properties: { 'Tagged for deletion': { checkbox: tagged !== false } },
      }),
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: 'Notion API error', detail: data });
    return res.status(200).json({ ok: true, id: data.id });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
