// Vercel serverless function: returns ALL rows from both Notion databases so every
// device shows the same shared list (read side of the sync). Token stays server-side.
//
// Required env var: NOTION_TOKEN   (optional: APP_KEY, NOTION_DELIVERIES_DB, NOTION_INVENTORY_DB)

const DBS = [
  { type: 'delivery', id: process.env.NOTION_DELIVERIES_DB || '74476427d7d3831ab84e8107cf70285a' },
  { type: 'inventory', id: process.env.NOTION_INVENTORY_DB || 'd1576427d7d382568a7b81a8e89c740c' },
];

const num = (p) => (p && typeof p.number === 'number') ? p.number : 0;

async function queryDb(token, db) {
  const out = [];
  let cursor;
  do {
    const r = await fetch(`https://api.notion.com/v1/databases/${db.id}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        page_size: 100,
        start_cursor: cursor,
        sorts: [{ property: 'Date', direction: 'descending' }],
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(data));
    for (const pg of data.results) {
      const props = pg.properties || {};
      out.push({
        notionId: pg.id,
        type: db.type,
        datetime: (props.Date && props.Date.date && props.Date.date.start) || '',
        location: (props.Select && props.Select.select && props.Select.select.name) || '',
        amounts: {
          'Lemon Poppy': num(props['Lemon Poppy']),
          'Sea Salt': num(props['Sea Salt Butter']),
          'Ube': num(props['Ube']),
          'Dot': num(props['Dot']),
        },
        taggedForDeletion: !!(props['Tagged for deletion'] && props['Tagged for deletion'].checkbox),
        synced: true,
      });
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'Server is missing NOTION_TOKEN' });
  if (process.env.APP_KEY && req.headers['x-app-key'] !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const all = (await Promise.all(DBS.map((db) => queryDb(token, db)))).flat();
    all.sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)));
    return res.status(200).json({ entries: all });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
