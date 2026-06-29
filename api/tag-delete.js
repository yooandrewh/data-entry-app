// Vercel serverless function: marks a row's "Tagged for deletion" column TRUE in
// the Google Sheet. Nothing is actually deleted — the row stays, flagged for review.
//
// Body: { pageId: "<sheet row id>", tagged?: true }
// Required env vars: GOOGLE_SA_JSON, SHEET_ID   (optional: APP_KEY)
//
// Safety: only rows in the Deliveries/Inventory tabs can be tagged.

import { getRows, updateCell } from './_sheets.js';

const TABS = [
  process.env.SHEET_DELIVERIES_TAB || 'Deliveries',
  process.env.SHEET_INVENTORY_TAB || 'Inventory',
];

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
    const { pageId, tagged } = req.body || {};
    if (!pageId || typeof pageId !== 'string') {
      return res.status(400).json({ error: 'Missing pageId' });
    }

    // Find the row by its id across the managed tabs, then flip the checkbox cell.
    for (const tab of TABS) {
      const { header, rows } = await getRows(tab);
      const hit = rows.find((r) => String(r.id) === pageId);
      if (hit) {
        await updateCell(tab, header, hit._row, 'Tagged for deletion', tagged === false ? 'FALSE' : 'TRUE');
        return res.status(200).json({ ok: true, id: pageId });
      }
    }
    return res.status(404).json({ error: 'Row not found in a managed tab' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
