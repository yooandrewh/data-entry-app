// Reads the Sales (Square/OCR POS) database — actual sales — for the Sales and
// Projections tabs. Token stays server-side.
//
// Required env var: NOTION_TOKEN  (optional: APP_KEY, NOTION_SALES_DB)
// NOTE: the Notion integration must be connected to the Sales database too.

const SALES_DB = process.env.NOTION_SALES_DB || '46376427d7d383bf97240131fa5eda73';
const num = (p) => (p && typeof p.number === 'number') ? p.number : 0;

async function querySales(token) {
  const out = [];
  let cursor;
  do {
    const r = await fetch(`https://api.notion.com/v1/databases/${SALES_DB}/query`, {
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
      const date = (props.Date && props.Date.date && props.Date.date.start) || '';
      if (!date) continue;
      out.push({
        date: String(date).slice(0, 10),
        location: (props.Select && props.Select.select && props.Select.select.name) || '',
        amounts: {
          'Lemon Poppy': num(props['Lemon Poppy']),
          'Sea Salt': num(props['Sea Salt Butter']),
          'Ube': num(props['Ube']),
        },
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
    const sales = await querySales(token);
    return res.status(200).json({ sales });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
