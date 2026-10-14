// Price ledger for the Costs tab, stored in the "Ledger" tab of the Google Sheet.
//
// One row per receipt line. Kind is "item" (a purchased ingredient), "tax" or "fee"
// (the receipt's tax / delivery / service lines). The client spreads tax and fees across the
// receipt's items, so cost per gram includes them. Nothing is ever hard-deleted: "remove"
// sets Deleted = TRUE.
//
// GET  -> { rows: [...] }  (rows not removed)
// POST { action: 'add', lines: [...] } | { action: 'remove', ids: [...] } | { action: 'approve', ids: [...], approved?: false }
// Costs use only lines with Approved = TRUE; new lines start unapproved unless the add sets approved: true.
//
// Auth: reads are open (the seed prices were already public in the app source). Writes need the
// x-ledger-code header to match env LEDGER_CODE; with no LEDGER_CODE set, writes are refused.
// Cost cap: no paid API is called; each write is limited to MAX_LINES rows.
//
// Required env vars: GOOGLE_SA_JSON, SHEET_ID, LEDGER_CODE   (optional: APP_KEY)

import { getRows, appendRows, ensureTab, updateCell } from './_sheets.js';

const TAB = 'Ledger';
const HEADER = ['Id', 'Receipt', 'Date', 'Vendor', 'Kind', 'Item', 'Amount', 'Unit', 'Price', 'Note', 'Link', 'Deleted', 'Approved'];
const MAX_LINES = 80;
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
// Price may be negative only for tax / fee lines (discounts); items stay >= 0.
const priceFor = (kind, v) => { const n = Number(v); if (v === '' || v == null || !Number.isFinite(n)) return null; return n >= 0 || kind === 'tax' || kind === 'fee' ? n : null; };
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
const isTrue = (v) => v === true || String(v).toUpperCase() === 'TRUE';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key, x-ledger-code');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (process.env.APP_KEY && req.headers['x-app-key'] !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      await ensureTab(TAB, HEADER);
      const { rows } = await getRows(TAB);
      return res.status(200).json({
        rows: rows.filter((r) => r.Id && !isTrue(r.Deleted)).map((r) => ({
          id: String(r.Id), receipt: String(r.Receipt), date: String(r.Date), vendor: String(r.Vendor),
          kind: String(r.Kind), item: String(r.Item), amt: num(r.Amount), unit: r.Unit === 'ml' ? 'ml' : 'g',
          price: priceFor(String(r.Kind), r.Price), note: String(r.Note), link: String(r.Link), approved: isTrue(r.Approved),
        })),
      });
    }

    // Writes: deny by default.
    const code = process.env.LEDGER_CODE;
    if (!code) return res.status(503).json({ error: 'Set LEDGER_CODE in Vercel to enable ledger writes' });
    if (req.headers['x-ledger-code'] !== code) return res.status(401).json({ error: 'Wrong code' });

    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    body = body && typeof body === 'object' ? body : {};
    await ensureTab(TAB, HEADER);

    if (body.action === 'add') {
      const lines = Array.isArray(body.lines) ? body.lines.slice(0, MAX_LINES) : [];
      const out = [];
      for (const l of lines) {
        if (!l) continue;
        const kind = ['item', 'tax', 'fee'].includes(l.kind) ? l.kind : 'item';
        const price = priceFor(kind, l.price);
        if (price == null || !clip(l.receipt, 80)) continue;
        if (kind === 'item' && (!clip(l.item, 80) || !(num(l.amt) > 0))) continue;
        out.push({
          Id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          Receipt: clip(l.receipt, 80), Date: isoDate(l.date), Vendor: clip(l.vendor, 60) || 'Unassigned',
          Kind: kind, Item: kind === 'item' ? clip(l.item, 80) : '', Amount: kind === 'item' ? num(l.amt) : '',
          Unit: l.unit === 'ml' ? 'ml' : 'g', Price: price, Note: clip(l.note, 200), Link: clip(l.link, 400), Deleted: '', Approved: l.approved === true && kind === 'item' ? 'TRUE' : '',
        });
      }
      if (!out.length) return res.status(400).json({ error: 'No valid lines' });
      await appendRows(TAB, out);
      return res.status(200).json({ written: out.length });
    }

    if (body.action === 'remove') {
      const ids = new Set((Array.isArray(body.ids) ? body.ids : []).slice(0, MAX_LINES).map(String));
      const { header, rows } = await getRows(TAB);
      let n = 0;
      for (const r of rows) if (ids.has(String(r.Id))) { await updateCell(TAB, header, r._row, 'Deleted', 'TRUE'); n++; }
      return res.status(200).json({ removed: n });
    }
    // Approve (or un-approve) item lines. Costs only use approved lines.
    if (body.action === 'approve') {
      const ids = new Set((Array.isArray(body.ids) ? body.ids : []).slice(0, MAX_LINES).map(String));
      const val = body.approved === false ? '' : 'TRUE';
      const { header, rows } = await getRows(TAB);
      let n = 0;
      for (const r of rows) if (ids.has(String(r.Id)) && !isTrue(r.Deleted)) { await updateCell(TAB, header, r._row, 'Approved', val); n++; }
      return res.status(200).json({ approved: val ? n : 0, cleared: val ? 0 : n });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
