// Receipt photo inbox: the phone drops a receipt photo here, the Mac picks it up, OCRs it and reports a status.
//
// Two tabs (created on first use):
//   ReceiptInbox  Id, Created, Name, Status, Result, Parts, Deleted     (one row per photo; Status pending|done|held|failed)
//   ReceiptParts  Id, N, Data                                            (the base64 JPEG split into 45000-char cells)
// A photo only sits in ReceiptParts until the Mac reports a result; then its Data cells are blanked.
//
// GET                 -> { rows: [{ id, created, name, status, result }] }   last 15 non-deleted, newest first. Open, never has image data.
// GET ?pending=1      -> { rows: [{ id, name, data }] }   Status 'pending', oldest first, max 3, data = base64 JPEG. Needs x-ledger-code.
// POST { action: 'add', name, data }              data = base64 JPEG, no "data:" prefix, starts '/9j/', max 700000 chars.
//                                                 400 'Too many waiting' when 10 or more rows are pending. -> { id }
// POST { action: 'result', id, status, result }   status done|held|failed, result clipped to 300 chars; blanks the photo cells. -> { updated: true }
// POST { action: 'remove', ids: [...] }           soft delete (Deleted = TRUE), max 20.
//
// Auth: plain GET and POST `add` (the phone upload) are open. Pending GET and the other POST actions need the x-ledger-code header to match env LEDGER_CODE
// (503 when LEDGER_CODE is unset, 401 when wrong). Cost cap: no paid API is called; photo size and the pending count are capped.
//
// Required env vars: GOOGLE_SA_JSON, SHEET_ID, LEDGER_CODE   (optional: APP_KEY)

import { getRows, appendRows, ensureTab, updateCell } from './_sheets.js';
import { codeEq } from './_auth.js';

const TAB = 'ReceiptInbox';
const HEADER = ['Id', 'Created', 'Name', 'Status', 'Result', 'Parts', 'Deleted'];
const PTAB = 'ReceiptParts';
const PHEADER = ['Id', 'N', 'Data'];
const MAX_DATA = 700000;
const PART = 45000;
const MAX_PENDING = 10;
const PENDING_BATCH = 3;
const LIST_LIMIT = 15;
const MAX_REMOVE = 20;
const RESULT_STATUS = ['done', 'held', 'failed'];
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
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
    const wantsPending = req.method === 'GET' && String((req.query && req.query.pending) || '') === '1';

    // The pending read (which carries photos) and every POST except `add` (the phone's upload) need the code.
    // `add` is open on purpose (internal tool, no login on the phone); it is capped by size and by the pending count,
    // and nothing it stores reaches the ledger unless the Mac parses it as a valid receipt, and lines land unapproved.
    const openAdd = req.method === 'POST' && req.body && (typeof req.body === 'string' ? /"action"\s*:\s*"add"/.test(req.body) : req.body.action === 'add');
    if ((req.method === 'POST' && !openAdd) || wantsPending) {
      const code = process.env.LEDGER_CODE;
      if (!code) return res.status(503).json({ error: 'Set LEDGER_CODE in Vercel to enable the receipt inbox' });
      if (!codeEq(req.headers['x-ledger-code'], code)) return res.status(401).json({ error: 'Wrong code' });
    }

    await ensureTab(TAB, HEADER);

    if (req.method === 'GET') {
      const { rows } = await getRows(TAB);
      const live = rows.filter((r) => r.Id && !isTrue(r.Deleted));
      if (!wantsPending) {
        return res.status(200).json({
          rows: live.slice(-LIST_LIMIT).reverse().map((r) => ({
            id: String(r.Id), created: String(r.Created), name: String(r.Name), status: String(r.Status), result: String(r.Result),
          })),
        });
      }
      const pending = live.filter((r) => r.Status === 'pending').slice(0, PENDING_BATCH);
      if (!pending.length) return res.status(200).json({ rows: [] });
      await ensureTab(PTAB, PHEADER);
      const parts = (await getRows(PTAB)).rows;
      const out = pending.map((r) => {
        const mine = parts.filter((p) => String(p.Id) === String(r.Id)).sort((a, b) => Number(a.N) - Number(b.N));
        return { id: String(r.Id), name: String(r.Name), data: mine.map((p) => String(p.Data)).join('') };
      });
      return res.status(200).json({ rows: out });
    }

    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    body = body && typeof body === 'object' ? body : {};

    if (body.action === 'add') {
      const data = typeof body.data === 'string' ? body.data : '';
      if (!data.startsWith('/9j/')) return res.status(400).json({ error: 'Not a JPEG' });
      if (data.length > MAX_DATA) return res.status(400).json({ error: 'Photo too large' });
      const { rows } = await getRows(TAB);
      const waiting = rows.filter((r) => r.Id && !isTrue(r.Deleted) && r.Status === 'pending').length;
      if (waiting >= MAX_PENDING) return res.status(400).json({ error: 'Too many waiting' });
      await ensureTab(PTAB, PHEADER);
      const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const parts = [];
      for (let i = 0, n = 0; i < data.length; i += PART, n++) parts.push({ Id: id, N: n, Data: data.slice(i, i + PART) });
      await appendRows(PTAB, parts);
      await appendRows(TAB, [{
        Id: id, Created: new Date().toISOString(), Name: clip(String(body.name || 'photo').replace(/·/g, ''), 60),
        Status: 'pending', Result: '', Parts: parts.length, Deleted: '',
      }]);
      return res.status(200).json({ id });
    }

    if (body.action === 'result') {
      const id = String(body.id || '');
      if (!id) return res.status(400).json({ error: 'Missing id' });
      if (!RESULT_STATUS.includes(body.status)) return res.status(400).json({ error: 'Bad status' });
      const { header, rows } = await getRows(TAB);
      const row = rows.find((r) => String(r.Id) === id && !isTrue(r.Deleted));
      if (!row) return res.status(404).json({ error: 'Not found' });
      await updateCell(TAB, header, row._row, 'Status', body.status);
      await updateCell(TAB, header, row._row, 'Result', clip(body.result, 300));
      await ensureTab(PTAB, PHEADER);
      const p = await getRows(PTAB);
      for (const r of p.rows) if (String(r.Id) === id && r.Data !== '') await updateCell(PTAB, p.header, r._row, 'Data', '');
      return res.status(200).json({ updated: true });
    }

    if (body.action === 'remove') {
      const ids = new Set((Array.isArray(body.ids) ? body.ids : []).slice(0, MAX_REMOVE).map(String));
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
