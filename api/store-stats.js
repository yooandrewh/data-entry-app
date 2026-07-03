// Returns the per-store analytics blob (AOV, basket, flavor mix, day-of-week,
// hourly, cashiers) that the local OCR pipeline computes and stores as a single
// JSON cell in the "StoreStats" tab. See push_store_stats.py in the pipeline.
//
// Required env vars: GOOGLE_SA_JSON, SHEET_ID   (optional: APP_KEY, SHEET_STORESTATS_TAB)

import { getValues } from './_sheets.js';

const TAB = process.env.SHEET_STORESTATS_TAB || 'StoreStats';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (process.env.APP_KEY && req.headers['x-app-key'] !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const vals = await getValues(`${TAB}!A1`);
    const blob = (vals[0] && vals[0][0]) || '';
    const stats = blob ? JSON.parse(String(blob)) : null;
    return res.status(200).json({ stats });
  } catch (e) {
    // Missing tab / not computed yet — degrade gracefully so the app shows an empty state.
    return res.status(200).json({ stats: null });
  }
}
