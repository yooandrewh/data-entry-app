// Kairos Logs (food safety records): Production, Delivery, Training, Complaints.
// One tab per log in the Google Sheet, created on first use. Nothing is hard-deleted:
// "remove" sets Deleted = TRUE.
//
// GET  ?log=production|delivery|training|complaints -> { rows: [...] }
// POST { action: 'add', log, rec } | { action: 'update', log, id, fields } | { action: 'remove', log, id }
//
// Auth: the logs hold names, signatures and customer complaints, and the app URL is public, so
// reads AND writes need the x-logs-code header to match env LOGS_CODE (falls back to LEDGER_CODE).
// With neither set, every call is refused (503). No paid API is called; text is clipped per field.
//
// Required env vars: GOOGLE_SA_JSON, SHEET_ID, LOGS_CODE or LEDGER_CODE   (optional: APP_KEY)

import { getRows, appendRow, ensureTab, updateCell } from './_sheets.js';

// Each log: sheet tab, the fields a client may set (name -> kind), and which of them may be edited later.
const LOGS = {
  production: { tab: 'Log Production', fields: { date: 'date', item: 'text', target: 'num', batchSize: 'num', batches: 'num', start: 'time', status: 'status', actual: 'num', notes: 'text', doneAt: 'num' }, edit: ['date', 'item', 'target', 'batchSize', 'batches', 'start', 'status', 'actual', 'notes', 'doneAt'] },
  delivery: { tab: 'Log Delivery', fields: { date: 'date', invoice: 'text', dest: 'text', left: 'time', arrived: 'time' }, edit: ['date', 'invoice', 'dest', 'left', 'arrived'] },
  training: { tab: 'Log Training', fields: { name: 'text', role: 'text', handler: 'text', manager: 'text', binder: 'date', sig: 'text' }, edit: ['name', 'role', 'handler', 'manager', 'binder', 'sig'] },
  complaints: { tab: 'Log Complaints', fields: { date: 'date', customer: 'text', product: 'text', problem: 'text', action: 'text', closed: 'date' }, edit: ['date', 'customer', 'product', 'problem', 'action', 'closed'] },
};
const MAX_ROWS = 2000;   // rows returned per read
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
const isTrue = (v) => v === true || String(v).toUpperCase() === 'TRUE';

function clean(kind, v) {
  if (kind === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
  if (kind === 'time') return /^\d{2}:\d{2}$/.test(String(v || '')) ? String(v) : '';
  if (kind === 'num') { if (v === '' || v == null) return ''; const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : ''; }
  if (kind === 'status') return v === 'done' ? 'done' : 'planned';
  return clip(v, 500);
}
// Required fields per log, checked on add and again on update (against the merged row).
function missing(key, row) {
  if (key === 'production') return !row.item || !row.date || !(Number(row.target) > 0) || !(Number(row.batchSize) > 0);
  if (key === 'delivery') return !row.invoice || !row.dest || !row.date;
  if (key === 'training') return !row.name;
  if (key === 'complaints') return !row.customer || !row.problem || !row.date;
  return false;
}
const headerFor = (cfg) => ['Id', 'Created', ...Object.keys(cfg.fields), 'Deleted'];

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
  if (!code) return res.status(503).json({ error: 'Set LOGS_CODE in Vercel to enable the logs' });
  if (req.headers['x-logs-code'] !== code) return res.status(401).json({ error: 'Wrong code' });

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    body = body && typeof body === 'object' ? body : {};
    const key = req.method === 'GET' ? String((req.query && req.query.log) || '') : String(body.log || '');
    const cfg = Object.prototype.hasOwnProperty.call(LOGS, key) ? LOGS[key] : null;
    if (!cfg) return res.status(400).json({ error: 'Unknown log' });
    const HEADER = headerFor(cfg);
    await ensureTab(cfg.tab, HEADER);

    if (req.method === 'GET') {
      const { rows } = await getRows(cfg.tab);
      const out = rows.filter((r) => r.Id && !isTrue(r.Deleted)).slice(-MAX_ROWS).map((r) => {
        const o = { id: String(r.Id), createdAt: Number(r.Created) || 0 };
        for (const f of Object.keys(cfg.fields)) o[f] = r[f] === undefined ? '' : r[f];
        return o;
      });
      return res.status(200).json({ rows: out });
    }

    if (body.action === 'add') {
      const rec = body.rec && typeof body.rec === 'object' ? body.rec : {};
      const row = { Id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), Created: Date.now(), Deleted: '' };
      for (const [f, kind] of Object.entries(cfg.fields)) row[f] = clean(kind, rec[f]);
      if (missing(key, row)) return res.status(400).json({ error: 'Missing fields' });
      await appendRow(cfg.tab, row);
      return res.status(200).json({ id: row.Id });
    }

    if (body.action === 'update' || body.action === 'remove') {
      const id = String(body.id || '');
      const { header, rows } = await getRows(cfg.tab);
      const r = rows.find((x) => String(x.Id) === id && !isTrue(x.Deleted));
      if (!r) return res.status(404).json({ error: 'Not found' });
      if (body.action === 'remove') {
        await updateCell(cfg.tab, header, r._row, 'Deleted', 'TRUE');
        return res.status(200).json({ removed: 1 });
      }
      const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
      const next = {}, merged = {};
      for (const f of Object.keys(cfg.fields)) merged[f] = r[f];
      for (const f of cfg.edit) if (f in fields) { next[f] = clean(cfg.fields[f], fields[f]); merged[f] = next[f]; }
      const quick = ['status', 'actual', 'doneAt', 'notes'];   // Mark Done / Reopen / Close never need the full check
      if (Object.keys(next).some((f) => !quick.includes(f)) && missing(key, merged)) return res.status(400).json({ error: 'Missing fields' });
      let n = 0;
      for (const f of Object.keys(next)) {
        await updateCell(cfg.tab, header, r._row, f, next[f]);
        n++;
      }
      return res.status(200).json({ updated: n });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
