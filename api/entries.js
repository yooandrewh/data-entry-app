// Vercel serverless function: returns ALL rows from the Deliveries + Inventory
// tabs of the Google Sheet so every device shows the same shared list (read side
// of the sync). The service-account key stays server-side.
//
// Required env vars: GOOGLE_SA_JSON, SHEET_ID   (optional: APP_KEY)

import { getRows } from './_sheets.js';

const TABS = [
  { type: 'delivery', tab: process.env.SHEET_DELIVERIES_TAB || 'Deliveries' },
  { type: 'inventory', tab: process.env.SHEET_INVENTORY_TAB || 'Inventory' },
];

// Sheet cells come back as strings; coerce to a number (blank -> 0).
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const truthy = (v) => /^(true|yes|1|__yes__)$/i.test(String(v || '').trim());

async function readTab({ type, tab }) {
  const { rows } = await getRows(tab);
  return rows
    .filter((r) => (r.id || r.Date))                 // skip fully-empty rows
    .map((r) => {
      // Goodwill (free samples) lives in the Deliveries tab as a negative
      // adjustment, marked by its "Goodwill — …" notes title.
      const isGoodwill = type === 'delivery' && /goodwill/i.test(String(r.notes || ''));
      return {
        notionId: r.id || '',                        // Sheets row id (kept the field name)
        type: isGoodwill ? 'goodwill' : type,
        datetime: r.Date || '',
        location: r.Select || '',
        amounts: {
          'Lemon Poppy': num(r['Lemon Poppy']),
          'Sea Salt': num(r['Sea Salt Butter']),
          'Ube': num(r['Ube']),
          'Dot': num(r['Dot']),
        },
        taggedForDeletion: truthy(r['Tagged for deletion']),
        synced: true,
      };
    });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (process.env.APP_KEY && req.headers['x-app-key'] !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const all = (await Promise.all(TABS.map(readTab))).flat();
    all.sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)));
    return res.status(200).json({ entries: all });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
