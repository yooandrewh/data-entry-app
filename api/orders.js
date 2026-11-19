// Customer orders (one row per receipt) and their item lines, for the CRM. Stored in two tabs of the Google Sheet:
//   Orders:     Id, Date, Time, Store, Cashier, Customer, Phone, Payment, Total, Fee, Basket, Madeleines, Flavors, Categories, Source
//   OrderItems: Order, Item, Modifiers, Qty, Price, Category, Product
// The data is built on the Mac from the sales-video OCR (scripts/crm/build_crm.py --push) and replaced whole each time.
//
// GET  -> { orders: [{ id, date, time, store, cashier, customer, phone, payment, total, fee, basket, madeleines, flavors,
//                      categories, items: [{ item, modifiers, qty, price, category, product }] }] }
// POST { action: 'replace', tab: 'Orders' | 'OrderItems', rows: [[...], ...] }  (rows in the header order above)
//
// Auth: this is personal data (names, phone numbers) on a public URL, so BOTH GET and POST need the x-ledger-code header
// to match env LEDGER_CODE (503 when unset, 401 when wrong). No paid API is called; writes are capped by row count.
// Errors never return Google's text and never echo cell values; request bodies are not logged.
//
// Required env vars: GOOGLE_SA_JSON, SHEET_ID, LEDGER_CODE

import { getRows, ensureTab, replaceTab } from './_sheets.js';
import { requireCode } from './_auth.js';

const TABS = {
  Orders: {
    header: ['Id', 'Date', 'Time', 'Store', 'Cashier', 'Customer', 'Phone', 'Payment', 'Total', 'Fee', 'Basket', 'Madeleines', 'Flavors', 'Categories', 'Source'],
    numeric: [8, 9, 10, 11],
    clips: [40, 10, 5, 20, 80, 80, 40, 40, 0, 0, 0, 0, 300, 300, 120],
    max: 6000,
  },
  OrderItems: {
    header: ['Order', 'Item', 'Modifiers', 'Qty', 'Price', 'Category', 'Product'],
    numeric: [3, 4],
    clips: [40, 120, 300, 0, 0, 80, 80],
    max: 20000,
  },
};

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

function validate(spec, rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > spec.max) return null;
  const out = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== spec.header.length) return null;
    const row = [];
    for (let c = 0; c < r.length; c++) {
      const v = cell(r[c], spec.numeric.includes(c), spec.clips[c]);
      if (v === undefined) return null;
      row.push(v);
    }
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
      await ensureTab('Orders', TABS.Orders.header);
      await ensureTab('OrderItems', TABS.OrderItems.header);
      const [o, i] = await Promise.all([getRows('Orders', { cache: true }), getRows('OrderItems', { cache: true })]);
      const byOrder = new Map();
      for (const r of i.rows) {
        const k = String(r.Order);
        if (!k) continue;
        if (!byOrder.has(k)) byOrder.set(k, []);
        byOrder.get(k).push({ item: str(r.Item), modifiers: str(r.Modifiers), qty: nm(r.Qty), price: nm(r.Price), category: str(r.Category), product: str(r.Product) });
      }
      const orders = o.rows.filter((r) => r.Id).map((r) => ({
        id: String(r.Id), date: str(r.Date), time: str(r.Time), store: str(r.Store), cashier: str(r.Cashier),
        customer: str(r.Customer), phone: str(r.Phone), payment: str(r.Payment), total: nm(r.Total), fee: nm(r.Fee),
        basket: nm(r.Basket), madeleines: nm(r.Madeleines), flavors: str(r.Flavors), categories: str(r.Categories),
        items: byOrder.get(String(r.Id)) || [],
      }));
      return res.status(200).json({ orders });
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { return res.status(400).json({ error: 'Bad request' }); } }
    body = body && typeof body === 'object' ? body : {};

    if (body.action !== 'replace') return res.status(400).json({ error: 'Unknown action' });
    if (typeof body.tab !== 'string' || !Object.prototype.hasOwnProperty.call(TABS, body.tab)) return res.status(400).json({ error: 'Unknown tab' });
    const spec = TABS[body.tab];
    const rows = validate(spec, body.rows);
    if (!rows) return res.status(400).json({ error: 'Invalid rows' });
    await replaceTab(body.tab, spec.header, [spec.header, ...rows]);
    return res.status(200).json({ written: rows.length });
  } catch {
    return res.status(500).json({ error: 'Server error' });
  }
}
