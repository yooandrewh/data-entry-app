// What the bakery spent, one row per receipt line, for the Profit page. Stored in one tab of the Google Sheet:
//   Spend: Date, Vendor, Receipt, Item, Qty, Amount, Category, Note     (Category: ingredient | supplies_equipment | other)
// Built on the Mac from the receipts backfill and the Ledger (scripts/spend/build_spend.py --push) and replaced whole each time.
//
// GET  -> { rows: [{ date, vendor, receipt, item, qty, amount, category, note }] }
// POST { action: 'replace', rows: [[...], ...] }  (rows in the header order above)
//
// Auth: this is the business's spending on a public URL, so BOTH GET and POST need the x-ledger-code header to match
// env LEDGER_CODE (503 when unset, 401 when wrong). No paid API is called; writes are capped by row count.
// Errors never return Google's text and never echo cell values; request bodies are not logged.
//
// Required env vars: GOOGLE_SA_JSON, SHEET_ID, LEDGER_CODE

import { getRows, ensureTab, replaceTab } from './_sheets.js';
import { requireCode } from './_auth.js';

const HEADER = ['Date', 'Vendor', 'Receipt', 'Item', 'Qty', 'Amount', 'Category', 'Note'];
const NUMERIC = [4, 5];
const CLIPS = [10, 40, 60, 140, 0, 0, 20, 200];
const CATEGORIES = ['ingredient', 'supplies_equipment', 'other'];
const MAX = 3000;

// Turn a cell into a safe string or number, or return undefined when it can't be used.
function cell(v, numeric, clip) {
  if (numeric) {
    if (v === '' || v == null) return '';
    const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
    return Number.isFinite(n) ? n : '';
  }
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (v == null) return '';
  if (typeof v !== 'string') return undefined;
  let s = v.slice(0, clip);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // never let a cell start a formula
  return s;
}

function validate(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX) return null;
  const out = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== HEADER.length) return null;
    const row = [];
    for (let c = 0; c < r.length; c++) {
      const v = cell(r[c], NUMERIC.includes(c), CLIPS[c]);
      if (v === undefined) return null;
      row.push(v);
    }
    if (!/^\d{4}-\d\d-\d\d$/.test(row[0]) || !CATEGORIES.includes(row[6]) || row[5] === '') return null;
    out.push(row);
  }
  return out;
}

const str = (v) => { const s = v == null ? '' : String(v); return /^'[=+\-@]/.test(s) ? s.slice(1) : s; };
const nm = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : null));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key, x-ledger-code');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireCode(req, res)) return; // deny by default, reads included

  try {
    if (req.method === 'GET') {
      await ensureTab('Spend', HEADER);
      const t = await getRows('Spend', { cache: true });
      const rows = t.rows.filter((r) => r.Date).map((r) => ({
        date: str(r.Date), vendor: str(r.Vendor), receipt: str(r.Receipt), item: str(r.Item),
        qty: nm(r.Qty), amount: nm(r.Amount), category: str(r.Category), note: str(r.Note),
      }));
      return res.status(200).json({ rows });
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { return res.status(400).json({ error: 'Bad request' }); } }
    body = body && typeof body === 'object' ? body : {};

    if (body.action !== 'replace') return res.status(400).json({ error: 'Unknown action' });
    const rows = validate(body.rows);
    if (!rows) return res.status(400).json({ error: 'Invalid rows' });
    await replaceTab('Spend', HEADER, [HEADER, ...rows]);
    return res.status(200).json({ written: rows.length });
  } catch {
    return res.status(500).json({ error: 'Server error' });
  }
}
