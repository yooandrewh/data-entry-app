// Writes the Finance tab's top-line numbers into the "Finance" tab of the Google Sheet.
// POST { month: '2026-10', rows: [[...], ...] } -> { written }. The tab is cleared and rewritten each time.
// Auth matches ledger writes: x-ledger-code must equal env LEDGER_CODE (503 if unset, 401 if wrong), plus APP_KEY if set.
// Cost cap: no paid API; at most MAX_ROWS x MAX_COLS cells, strings clipped.
//
// Required env vars: GOOGLE_SA_JSON, SHEET_ID, LEDGER_CODE   (optional: APP_KEY)

import { replaceTab } from './_sheets.js';

const MAX_ROWS = 200, MAX_COLS = 12, MAX_STR = 120, MODEL_STR = 200;
// Plain strings are written as-is; strings starting with '=' must use only these characters.
const FORMULA_OK = /^=[A-Za-z0-9 +\-*\/().,:$!"']*$/;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key, x-ledger-code');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (process.env.APP_KEY && req.headers['x-app-key'] !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const code = process.env.LEDGER_CODE;
  if (!code) return res.status(503).json({ error: 'Set LEDGER_CODE in Vercel to enable this' });
  if (req.headers['x-ledger-code'] !== code) return res.status(401).json({ error: 'Wrong code' });

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    body = body && typeof body === 'object' ? body : {};
    if (!/^\d{4}-\d{2}$/.test(String(body.month || ''))) return res.status(400).json({ error: 'Bad month' });
    const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, MAX_ROWS).map((r) =>
      (Array.isArray(r) ? r : []).slice(0, MAX_COLS)
        .map((c) => (typeof c === 'number' && Number.isFinite(c) ? c : typeof c === 'string' ? c.slice(0, MAX_STR) : '')));
    if (!rows.length) return res.status(400).json({ error: 'No rows' });
    let model = null;
    if (body.model != null) {
      const raw = body.model && Array.isArray(body.model.rows2d) ? body.model.rows2d : null;
      if (!raw || !raw.length) return res.status(400).json({ error: 'Bad model' });
      model = [];
      for (const r of raw.slice(0, MAX_ROWS)) {
        if (!Array.isArray(r)) return res.status(400).json({ error: 'Bad model' });
        const out = [];
        for (const c of r.slice(0, MAX_COLS)) {
          if (typeof c === 'number' && Number.isFinite(c)) out.push(c);
          else if (typeof c === 'string') {
            if (c.length > MODEL_STR) return res.status(400).json({ error: 'Bad model' });
            if ((c[0] === '=' && !FORMULA_OK.test(c)) || /^[+\-@]/.test(c)) return res.status(400).json({ error: 'Bad model' });
            out.push(c);
          } else if (c == null) out.push('');
          else return res.status(400).json({ error: 'Bad model' });
        }
        model.push(out);
      }
    }
    await replaceTab('Finance', ['Finance'], rows);
    if (model) await replaceTab('Finance Model', ['Finance Model'], model, { formulas: true });
    return res.status(200).json({ written: rows.length, model: model ? model.length : 0 });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err).slice(0, 200) });
  }
}
