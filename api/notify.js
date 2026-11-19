// Phone push for the Mac collector (scripts/uploads/upload_poll.py): a new upload arrived, or the sales OCR finished.
// Same ntfy topic as entry notifications (api/sync.js), which stays in the Vercel env NTFY_TOPIC and never leaves the server.
//
// POST { event: 'upload' | 'ocr' | 'reconcile', videos, receipts, detail } -> { ok }
// Auth: needs x-ledger-code = env LEDGER_CODE (deny by default; 503 unset, 401 wrong). The message text is built here from
// the event name and two small counts; `detail` is a short plain line (clipped, control characters stripped).
// Cost cap: free service, one message per call, body clipped to 300 chars.
// Required env vars: LEDGER_CODE, NTFY_TOPIC

import { codeEq } from './_auth.js';
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
const count = (v) => Math.max(0, Math.min(99, Math.floor(Number(v) || 0)));

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const code = process.env.LEDGER_CODE;
  if (!code) return res.status(503).json({ error: 'Set LEDGER_CODE in Vercel' });
  if (!codeEq(req.headers['x-ledger-code'], code)) return res.status(401).json({ error: 'Wrong code' });
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return res.status(503).json({ error: 'NTFY_TOPIC not set' });

  try {
    let b = req.body;
    if (typeof b === 'string') b = JSON.parse(b || '{}');
    b = b && typeof b === 'object' ? b : {};
    const detail = clip(b.detail, 200);
    let title, body, tag;
    if (b.event === 'upload') {
      const v = count(b.videos), r = count(b.receipts);
      if (!v && !r) return res.status(400).json({ error: 'Nothing to report' });
      const parts = [];
      if (v) parts.push(`${v} sales video${v === 1 ? '' : 's'}`);
      if (r) parts.push(`${r} receipt photo${r === 1 ? '' : 's'}`);
      title = 'New upload';  // ASCII only (HTTP header)
      body = `${parts.join(' + ')} collected on the Mac.` + (v ? ' Sales OCR is starting.' : '') + (detail ? ` ${detail}` : '');
      tag = 'inbox_tray';
    } else if (b.event === 'ocr') {
      title = 'Sales OCR done';
      body = 'Ready to review in inbox_summary.md.' + (detail ? ` ${detail}` : '');
      tag = 'white_check_mark';
    } else if (b.event === 'reconcile') {
      title = 'Inventory reconciled';
      body = detail || 'Counts and deliveries checked against sales.';
      tag = 'scales';
    } else {
      return res.status(400).json({ error: 'Unknown event' });
    }
    const r = await fetch(`https://ntfy.sh/${topic}`, { method: 'POST', headers: { Title: title, Tags: tag }, body: body.slice(0, 300) });
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok });
  } catch (e) {
    return res.status(500).json({ error: 'notify failed' });
  }
}
