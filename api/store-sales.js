// Reads the "Store Sales" tab — WHOLE-STORE daily performance (all products, not
// just madeleines): transactions, avg ticket, revenue, and the madeleine count.
// Columns are unevenly filled per store (some days have gross, some net; LM has no
// transaction counts) so we normalize here.
//
// Required env vars: GOOGLE_SA_JSON, SHEET_ID   (optional: APP_KEY, SHEET_STORE_SALES_TAB)

import { getRows } from './_sheets.js';

const TAB = process.env.SHEET_STORE_SALES_TAB || 'Store Sales';
const num = (v) => {
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) && String(v).trim() !== '' ? n : null;
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (process.env.APP_KEY && req.headers['x-app-key'] !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { rows } = await getRows(TAB);
    const sales = [];
    for (const r of rows) {
      const date = String(r.Date || '').slice(0, 10);
      const location = r.Location || '';
      if (!date || !location) continue;
      // revenue: prefer gross, fall back to net
      const revenue = num(r['Gross Sales']) ?? num(r['Net Revenue']);
      sales.push({
        date, location,
        transactions: num(r['Transactions']),
        avgTicket: num(r['Avg Ticket']),
        revenue,
        madeleines: num(r['Madeleines']) ?? 0,
      });
    }
    return res.status(200).json({ sales });
  } catch (e) {
    return res.status(200).json({ sales: [] });
  }
}
