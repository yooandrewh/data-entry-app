// Shared invoice history, stored in the "Invoice History" tab of the Google Sheet so every device sees the same list.
// One row per invoice number; saving the same number again replaces its row's contents. Nothing is hard-deleted:
// "remove" sets Deleted = TRUE.
//
// GET           -> { rows: [{ num, store, printed, total, createdAt, hasHtml }] }   (no html, keeps the response small)
// GET ?num=X    -> { row: { num, store, printed, total, html, text } }
// POST { action: 'save', inv: { num, store, printed, total, html, text } } | { action: 'remove', num }
//
// Auth: invoices hold store names and totals, and the app URL is public, so reads AND writes need the x-logs-code
// header to match env LOGS_CODE (falls back to LEDGER_CODE), the same check as /api/logs. With neither set, every
// call is refused (503). No paid API is called; each field is clipped and rows per read are capped.
//
// Required env vars: GOOGLE_SA_JSON, SHEET_ID, LOGS_CODE or LEDGER_CODE   (optional: APP_KEY)

import { getRows, appendRow, ensureTab, updateCell } from './_sheets.js';

const TAB = 'Invoice History';
const HEADER = ['Num', 'Created', 'Store', 'Printed', 'Total', 'Html', 'Text', 'Deleted'];
const MAX_ROWS = 200;
const HTML_MAX = 45000;   // a Sheets cell holds 50,000 characters; an invoice that is bigger keeps its row but no copy
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
const isTrue = (v) => v === true || String(v).toUpperCase() === 'TRUE';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key, x-logs-code');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (process.env.APP_KEY && req.headers['x-app-key'] !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // Deny by default, for reads and writes.
  const code = process.env.LOGS_CODE || process.env.LEDGER_CODE;
  if (!code) return res.status(503).json({ error: 'Set LOGS_CODE in Vercel to enable shared invoices' });
  if (req.headers['x-logs-code'] !== code) return res.status(401).json({ error: 'Wrong code' });

  try {
    await ensureTab(TAB, HEADER);

    if (req.method === 'GET') {
      const { rows } = await getRows(TAB);
      const live = rows.filter((r) => r.Num && !isTrue(r.Deleted));
      const num = String((req.query && req.query.num) || '');
      if (num) {
        const r = live.find((x) => String(x.Num) === num);
        if (!r) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json({ row: { num: String(r.Num), store: String(r.Store), printed: String(r.Printed), total: String(r.Total), html: String(r.Html), text: String(r.Text) } });
      }
      return res.status(200).json({
        rows: live.slice(-MAX_ROWS).map((r) => ({ num: String(r.Num), store: String(r.Store), printed: String(r.Printed), total: String(r.Total), createdAt: Number(r.Created) || 0, hasHtml: !!r.Html })),
      });
    }

    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    body = body && typeof body === 'object' ? body : {};

    if (body.action === 'save') {
      const inv = body.inv && typeof body.inv === 'object' ? body.inv : {};
      const num = clip(inv.num, 80);
      if (!num) return res.status(400).json({ error: 'Missing invoice number' });
      const html = String(inv.html || '');
      const fields = { Store: clip(inv.store, 80), Printed: clip(inv.printed, 20), Total: clip(inv.total, 30), Html: html.length <= HTML_MAX ? html : '', Text: clip(inv.text, 8000) };
      const { header, rows } = await getRows(TAB);
      const r = rows.find((x) => String(x.Num) === num && !isTrue(x.Deleted));
      if (r) {
        for (const [k, v] of Object.entries(fields)) await updateCell(TAB, header, r._row, k, v);
        return res.status(200).json({ updated: 1 });
      }
      await appendRow(TAB, { Num: num, Created: Date.now(), ...fields, Deleted: '' });
      return res.status(200).json({ saved: 1 });
    }

    if (body.action === 'remove') {
      const num = String(body.num || '');
      const { header, rows } = await getRows(TAB);
      let n = 0;
      for (const r of rows) if (String(r.Num) === num && !isTrue(r.Deleted)) { await updateCell(TAB, header, r._row, 'Deleted', 'TRUE'); n++; }
      return res.status(200).json({ removed: n });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
