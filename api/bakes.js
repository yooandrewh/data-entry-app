// Bake records for Bake Day, stored in the "Bakes" tab of the Google Sheet.
//
// One row per finished bake: the date, how many minutes it took, which recipes and batches, a note.
// Nothing is hard-deleted: "remove" sets Deleted = TRUE.
//
// GET  -> { rows: [...] }  (rows not removed)
// POST { action: 'add', rows: [{ date, minutes, recipes, note }] } | { action: 'remove', ids: [...] }
//
// Auth: reads are open. Writes need the x-ledger-code header to match env LEDGER_CODE; with no
// LEDGER_CODE set, writes are refused. Cost cap: no paid API is called; each write is limited to MAX_ROWS rows.
//
// Required env vars: GOOGLE_SA_JSON, SHEET_ID, LEDGER_CODE   (optional: APP_KEY)

import { getRows, appendRows, ensureTab, updateCell } from './_sheets.js';

const TAB = 'Bakes';
const HEADER = ['Id', 'Date', 'Minutes', 'Recipes', 'Note', 'Deleted'];
const MAX_ROWS = 20;
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
const num = (v) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) && n >= 0 && n < 1440 ? n : ''; };
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
          id: String(r.Id), date: String(r.Date), minutes: r.Minutes === '' ? null : Number(r.Minutes),
          recipes: String(r.Recipes), note: String(r.Note),
        })),
      });
    }

    // Writes: deny by default.
    const code = process.env.LEDGER_CODE;
    if (!code) return res.status(503).json({ error: 'Set LEDGER_CODE in Vercel to enable bake records' });
    if (req.headers['x-ledger-code'] !== code) return res.status(401).json({ error: 'Wrong code' });

    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    body = body && typeof body === 'object' ? body : {};
    await ensureTab(TAB, HEADER);

    if (body.action === 'add') {
      const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : [];
      const out = [];
      for (const r of rows) {
        if (!r || !isoDate(r.date)) continue;
        out.push({
          Id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          Date: isoDate(r.date), Minutes: num(r.minutes), Recipes: clip(r.recipes, 400), Note: clip(r.note, 200), Deleted: '',
        });
      }
      if (!out.length) return res.status(400).json({ error: 'No valid rows' });
      await appendRows(TAB, out);
      return res.status(200).json({ written: out.length });
    }

    if (body.action === 'remove') {
      const ids = new Set((Array.isArray(body.ids) ? body.ids : []).slice(0, MAX_ROWS).map(String));
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
