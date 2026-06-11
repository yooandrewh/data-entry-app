// Vercel serverless function: marks a Notion row's "Tagged for deletion" checkbox.
// Nothing is actually deleted — the row stays in Notion, flagged for review.
//
// Body: { pageId: "<notion page id>", tagged?: true }
// Required env var: NOTION_TOKEN   (optional: APP_KEY — same as sync.js)

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
    if (!pageId) return res.status(400).json({ error: 'Missing pageId' });

    const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
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
