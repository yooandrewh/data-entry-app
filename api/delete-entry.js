// Vercel serverless function: PERMANENTLY delete a Deliveries/Inventory row from
// the Google Sheet by its row id (hard delete — the row is removed, not flagged).
//
// Body: { pageId }
// Required env vars: GOOGLE_SA_JSON, SHEET_ID   (optional: APP_KEY)
//
// Safety: only rows in the Deliveries/Inventory tabs can be deleted.

import { getRows, deleteRow } from './_sheets.js';

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
    const { pageId } = req.body || {};
    if (!pageId || typeof pageId !== 'string') {
      return res.status(400).json({ error: 'Missing pageId' });
    }
    for (const tab of TABS) {
      const { rows } = await getRows(tab);
      const hit = rows.find((r) => String(r.id) === pageId);
      if (hit) {
        await deleteRow(tab, hit._row);
        return res.status(200).json({ ok: true, id: pageId });
      }
    }
    return res.status(404).json({ error: 'Row not found in a managed tab' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
