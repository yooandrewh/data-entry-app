// Pantry counts for the Pantry page, stored in the "Pantry" tab of the Google Sheet.
//
// One row per physical count of an ingredient ("we have 3,400 g of cornstarch on <date>").
// The app adds ledger purchases dated after the latest count to get what is on hand now, so the
// ledger stays the single record of what was bought. Nothing is hard-deleted: "remove" sets Deleted = TRUE.
//
// GET  -> { rows: [...] }  (rows not removed)
// POST { action: 'add', lines: [{ item, amt, unit, date, note }] } | { action: 'remove', ids: [...] }
//
// Auth: reads are open (same as the ledger). Writes need the x-ledger-code header to match env
// LEDGER_CODE; with no LEDGER_CODE set, writes are refused. Cost cap: no paid API is called; each
// write is limited to MAX_LINES rows.
//
// Required env vars: GOOGLE_SA_JSON, SHEET_ID, LEDGER_CODE   (optional: APP_KEY)

import { getRows, appendRows, ensureTab, updateCell } from './_sheets.js';
import { codeEq } from './_auth.js';

const TAB = 'Pantry';
const HEADER = ['Id', 'Item', 'Amount', 'Unit', 'Date', 'Note', 'Deleted'];
const MAX_LINES = 80;
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
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
      const { rows } = await getRows(TAB, { cache: true });
      return res.status(200).json({
        rows: rows.filter((r) => r.Id && !isTrue(r.Deleted)).map((r) => ({
          id: String(r.Id), item: String(r.Item), amt: num(r.Amount), unit: r.Unit === 'ml' ? 'ml' : r.Unit === 'pcs' ? 'pcs' : 'g',
          date: String(r.Date), note: String(r.Note),
        })),
      });
    }

    // Writes: deny by default.
    const code = process.env.LEDGER_CODE;
    if (!code) return res.status(503).json({ error: 'Set LEDGER_CODE in Vercel to enable pantry writes' });
    if (!codeEq(req.headers['x-ledger-code'], code)) return res.status(401).json({ error: 'Wrong code' });

    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    body = body && typeof body === 'object' ? body : {};
    await ensureTab(TAB, HEADER);

    if (body.action === 'add') {
      const lines = Array.isArray(body.lines) ? body.lines.slice(0, MAX_LINES) : [];
      const out = [];
      for (const l of lines) {
        if (!l || !clip(l.item, 80) || num(l.amt) == null) continue;
        out.push({
          Id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          Item: clip(l.item, 80), Amount: num(l.amt), Unit: l.unit === 'ml' ? 'ml' : l.unit === 'pcs' ? 'pcs' : 'g',
          Date: isoDate(l.date), Note: clip(l.note, 200), Deleted: '',
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
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
