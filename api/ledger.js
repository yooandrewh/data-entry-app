// Price ledger for the Costs tab, stored in the "Ledger" tab of the Google Sheet.
//
// One row per receipt line. Kind is "item" (a purchased ingredient), "tax" or "fee"
// (the receipt's tax / delivery / service lines). The client spreads tax and fees across the
// receipt's items, so cost per gram includes them. Nothing is ever hard-deleted: "remove"
// sets Deleted = TRUE.
//
// GET  -> { rows: [...] }  (rows not removed)
// POST { action: 'add', lines: [...] } | { action: 'remove', ids: [...] } | { action: 'approve', ids: [...], approved?: false }
//      | { action: 'setlink', ids: [...], link: '<product link>' }  (Amazon saved as https://www.amazon.com/dp/<ASIN>; Costco / Target / WebstaurantStore / Pastry Depot / Gelato Supply saved without the query string)
// Costs use only lines with Approved = TRUE; new lines start unapproved unless the add sets approved: true.
//
// Auth: reads are open (the seed prices were already public in the app source). Writes need the
// x-ledger-code header to match env LEDGER_CODE; with no LEDGER_CODE set, writes are refused.
// Cost cap: no paid API is called; each write is limited to MAX_LINES rows.
//
// Required env vars: GOOGLE_SA_JSON, SHEET_ID, LEDGER_CODE

import { getRows, appendRows, ensureTab, updateCell } from './_sheets.js';
import { codeEq } from './_auth.js';

const TAB = 'Ledger';
const HEADER = ['Id', 'Receipt', 'Date', 'Vendor', 'Kind', 'Item', 'Amount', 'Unit', 'Price', 'Note', 'Link', 'Deleted', 'Approved'];
const MAX_LINES = 80;
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
// Price may be negative only for tax / fee lines (discounts); items stay >= 0.
const priceFor = (kind, v) => { const n = Number(v); if (v === '' || v == null || !Number.isFinite(n)) return null; return n >= 0 || kind === 'tax' || kind === 'fee' ? n : null; };
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
const isTrue = (v) => v === true || String(v).toUpperCase() === 'TRUE';

// Amazon links: only amazon.com product pages and the amzn.to / a.co short links are accepted (a short link is followed
// on the server, host-checked at every hop, so the app cannot be pointed at other sites). Saved as the plain /dp/ASIN form.
const AMZ_HOST = /^(www\.)?amazon\.com$/i, AMZ_SHORT = /^(amzn\.to|a\.co)$/i;
const asinOf = (u) => { const m = /(?:\/dp\/|\/gp\/product\/|\/product\/)([A-Z0-9]{10})(?:[\/?#]|$)/i.exec(u); return m ? m[1].toUpperCase() : ''; };
async function amazonLink(input) {
  let u; try { u = new URL(String(input || '').trim()); } catch { return ''; }
  for (let hop = 0; hop < 4; hop++) {
    if (u.protocol !== 'https:') return '';
    if (AMZ_HOST.test(u.hostname)) { const a = asinOf(u.href); return a ? 'https://www.amazon.com/dp/' + a : ''; }
    if (!AMZ_SHORT.test(u.hostname)) return '';
    const r = await fetch(u.href, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) });
    const loc = r.headers.get('location'); if (!loc) return '';
    try { u = new URL(loc, u); } catch { return ''; }
  }
  return '';
}

// Other retailer links (Costco, Target, WebstaurantStore, Pastry Depot, Gelato Supply): https only, host on this list, saved without the query string.
const SHOP_HOST = /^(www\.|sameday\.)?(costco\.com|costcobusinessdelivery\.com|target\.com|webstaurantstore\.com|pastrydepot\.com|gelatosupply\.com)$/i;
async function shopLink(input) {
  const a = await amazonLink(input); if (a) return a;
  let raw = String(input || '').trim(); if (/^(www\.)[a-z0-9.-]+\//i.test(raw)) raw = 'https://' + raw;
  let u; try { u = new URL(raw); } catch { return ''; }
  return u.protocol === 'https:' && SHOP_HOST.test(u.hostname) ? (u.origin + u.pathname).slice(0, 400) : '';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key, x-ledger-code');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (req.method === 'GET') {
      await ensureTab(TAB, HEADER);
      const { rows } = await getRows(TAB, { cache: true });
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
    if (!codeEq(req.headers['x-ledger-code'], code)) return res.status(401).json({ error: 'Wrong code' });

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
    // Attach a product link to ledger lines (the shopping list's Amazon Add to cart button reads Amazon ones).
    if (body.action === 'setlink') {
      const link = await shopLink(body.link);
      if (!link) return res.status(400).json({ error: 'That is not a link from a store the app knows (Amazon, Costco, Target, WebstaurantStore, Pastry Depot, Gelato Supply)' });
      const ids = new Set((Array.isArray(body.ids) ? body.ids : []).slice(0, MAX_LINES).map(String));
      const { header, rows } = await getRows(TAB);
      let n = 0;
      for (const r of rows) if (ids.has(String(r.Id)) && !isTrue(r.Deleted) && String(r.Kind) === 'item') { await updateCell(TAB, header, r._row, 'Link', link); n++; }
      if (!n) return res.status(400).json({ error: 'No matching lines' });
      return res.status(200).json({ updated: n, link });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
