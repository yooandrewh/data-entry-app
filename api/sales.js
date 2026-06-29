// Reads the "Sales" tab of the Google Sheet — the complete daily POS/OCR sales —
// for the Sales and Projections tabs. The service-account key stays server-side.
//
// Required env vars: GOOGLE_SA_JSON, SHEET_ID   (optional: APP_KEY, SHEET_SALES_TAB)

import { getRows } from './_sheets.js';

const SALES_TAB = process.env.SHEET_SALES_TAB || 'Sales';
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (process.env.APP_KEY && req.headers['x-app-key'] !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { rows } = await getRows(SALES_TAB);
    const sales = [];
    for (const r of rows) {
      const date = String(r.Date || '');
      if (!date) continue;
      const amounts = {
        'Lemon Poppy': num(r['Lemon Poppy']),
        'Sea Salt': num(r['Sea Salt Butter']),
        'Ube': num(r['Ube']),
        'Dot': num(r['Dot']),
        'Matcha': num(r['Matcha']),
        'Chocolate': num(r['Chocolate']),
        'Unknown': num(r['Unknown']),
      };
      // The OCR/parser ALREADY folds each flight's 3 madeleines into the LP/SS/Ube
      // columns. Flights is an informational count, NOT a separate bucket — don't add it.
      const flights = num(r['Flights']);
      const total = Object.values(amounts).reduce((s, v) => s + v, 0);
      sales.push({ date: date.slice(0, 10), location: r.Location || '', amounts, total, flights });
    }
    return res.status(200).json({ sales });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
