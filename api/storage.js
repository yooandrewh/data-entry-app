// Storage moves and counts for the Inventory > Storage page, stored in the "Storage" tab of the Google Sheet.
//
// Only the four storages are tracked here. A move into a storage is a + row, a move out is a - row, and a move
// between two storages is two rows sharing one Group. Kitchen and store deliveries are NOT tracked: they only
// appear in From / To. A count row sets what a storage holds for one item on a date (moves after it add to it).
// Nothing is hard-deleted: "remove" sets Deleted = TRUE on every row of the group.
//
// GET  -> { rows: [...] }  (rows not removed)
// POST { action: 'add', lines: [{ group, date, storage, item, amt, kind: 'move'|'count', from, to, note }] }
//      | { action: 'remove', ids: [...] }   (ids may be row ids or group ids)
//
// Auth: reads are open (same as pantry). Writes need the x-ledger-code header to match env LEDGER_CODE;
// with no LEDGER_CODE set, writes are refused. Cost cap: no paid API is called; each write is limited to MAX_LINES rows.
//
// Required env vars: GOOGLE_SA_JSON, SHEET_ID, LEDGER_CODE   (optional: APP_KEY)

import { getRows, appendRows, ensureTab, updateCell } from './_sheets.js';

const TAB = 'Storage';
const HEADER = ['Id', 'Group', 'Date', 'Storage', 'Item', 'Amount', 'Kind', 'From', 'To', 'Note', 'Deleted'];
const STORAGES = ['BP Storage', 'Fullerton Storage', 'La Mirada Storage', 'Stanton Storage'];
const PLACES = ['Kitchen', ...STORAGES, 'La Mirada delivery', 'Stanton delivery'];
const MAX_LINES = 40;
const clip = (v, n) => String(v == null ? '' : v).replace(/[\r\n·]/g, ' ').slice(0, n);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(String(v || '')) ? String(v) : '');
const isTrue = (v) => v === true || String(v).toUpperCase() === 'TRUE';
const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

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
          id: String(r.Id), group: String(r.Group || r.Id), date: String(r.Date), storage: String(r.Storage), item: String(r.Item),
          amt: Number(r.Amount) || 0, kind: r.Kind === 'count' ? 'count' : 'move', from: String(r.From), to: String(r.To), note: String(r.Note),
        })),
      });
    }

    // Writes: deny by default.
    const code = process.env.LEDGER_CODE;
    if (!code) return res.status(503).json({ error: 'Set LEDGER_CODE in Vercel to enable storage writes' });
    if (req.headers['x-ledger-code'] !== code) return res.status(401).json({ error: 'Wrong code' });

    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    body = body && typeof body === 'object' ? body : {};
    await ensureTab(TAB, HEADER);

    if (body.action === 'add') {
      const lines = Array.isArray(body.lines) ? body.lines.slice(0, MAX_LINES) : [];
      const out = [];
      for (const l of lines) {
        if (!l || !STORAGES.includes(l.storage) || !clip(l.item, 40)) continue;
        const amt = Number(l.amt);
        const kind = l.kind === 'count' ? 'count' : 'move';
        if (!Number.isFinite(amt) || amt === 0 && kind === 'move') continue;
        if (kind === 'count' && amt < 0) continue;
        if (Math.abs(amt) > 100000) continue;
        const id = rid('s');
        out.push({
          Id: id, Group: clip(l.group, 40) || id, Date: isoDate(l.date), Storage: l.storage, Item: clip(l.item, 40), Amount: Math.round(amt),
          Kind: kind, From: PLACES.includes(l.from) ? l.from : '', To: PLACES.includes(l.to) ? l.to : '', Note: clip(l.note, 200), Deleted: '',
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
      for (const r of rows) if (ids.has(String(r.Id)) || (r.Group && ids.has(String(r.Group)))) { await updateCell(TAB, header, r._row, 'Deleted', 'TRUE'); n++; }
      return res.status(200).json({ removed: n });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
