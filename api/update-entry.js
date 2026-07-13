// Vercel serverless function: edit an existing Deliveries/Inventory row in the
// Google Sheet — update its date/time, location, and/or amounts by row id.
//
// Body: { pageId, datetime?, location?, amounts? }
// Required env vars: GOOGLE_SA_JSON, SHEET_ID   (optional: APP_KEY)
//
// Safety: only rows in the Deliveries/Inventory tabs are editable, and goodwill /
// transfer rows are refused here (they're signed / two-legged — delete + re-add).

import { getRows, updateCell } from './_sheets.js';

const TABS = [
  process.env.SHEET_DELIVERIES_TAB || 'Deliveries',
  process.env.SHEET_INVENTORY_TAB || 'Inventory',
];

// App product name -> Sheet column name.
const PRODUCT_MAP = {
  'Lemon Poppy': 'Lemon Poppy',
  'Sea Salt': 'Sea Salt Butter',
  'Ube': 'Ube',
  'Dot': 'Dot',
};
const ALLOWED_LOCATIONS = ['La Mirada', 'Stanton'];

function cleanAmount(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1000000, Math.min(n, 1000000));
}

// Local "YYYY-MM-DDTHH:MM" -> full ISO with the correct America/Los_Angeles offset.
function laDateTime(local) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(local))) return null;
  const asUTC = new Date(local + ':00Z');
  const tzName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', timeZoneName: 'longOffset',
  }).formatToParts(asUTC).find((p) => p.type === 'timeZoneName').value;
  const m = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  const offset = m ? `${m[1]}${m[2].padStart(2, '0')}:${m[3] || '00'}` : 'Z';
  return `${local}:00${offset}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (process.env.APP_KEY && req.headers['x-app-key'] !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { pageId, datetime, location, amounts } = req.body || {};
    if (!pageId || typeof pageId !== 'string') {
      return res.status(400).json({ error: 'Missing pageId' });
    }
    if (location && !ALLOWED_LOCATIONS.includes(location)) {
      return res.status(400).json({ error: `Unknown location: ${location}` });
    }
    let startIso;
    if (datetime) {
      startIso = laDateTime(datetime);
      if (!startIso) return res.status(400).json({ error: `Invalid datetime: ${datetime}` });
    }

    for (const tab of TABS) {
      const { header, rows } = await getRows(tab);
      const hit = rows.find((r) => String(r.id) === pageId);
      if (!hit) continue;

      // Goodwill / transfer rows are stored as signed / paired adjustments — editing
      // them cell-by-cell would desync the pair. Refuse; the app hides edit for them.
      if (/goodwill|transfer/i.test(String(hit.notes || ''))) {
        return res.status(400).json({ error: "Goodwill/transfer entries can't be edited — delete and re-add." });
      }

      if (startIso) await updateCell(tab, header, hit._row, 'Date', startIso);
      if (location) await updateCell(tab, header, hit._row, 'Select', location);
      if (amounts && typeof amounts === 'object') {
        for (const [appName, colName] of Object.entries(PRODUCT_MAP)) {
          if (appName in amounts) await updateCell(tab, header, hit._row, colName, cleanAmount(amounts[appName]));
        }
      }
      return res.status(200).json({ ok: true, id: pageId });
    }
    return res.status(404).json({ error: 'Row not found in a managed tab' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
