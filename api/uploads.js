// The waiting room for uploaded files: the Mac job lists what is there, downloads it, then removes it.
//
// GET  -> { files: [{ pathname, url, size, uploadedAt, kind: 'video'|'receipt', name }] }
// POST { action: 'remove', pathnames: [...] } -> { removed: N }
//
// Auth: both need the x-ledger-code header to match env LEDGER_CODE (503 if unset, 401 if wrong).
// Only paths under inbox/ can be listed or removed. No paid API is called; remove is capped at MAX_REMOVE per call.
//
// Required env vars: BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID (set by connecting a Blob store), LEDGER_CODE

import { list, del } from '@vercel/blob';
import { codeEq } from './_auth.js';

const MAX_REMOVE = 20;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-ledger-code');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const code = process.env.LEDGER_CODE;
  if (!code) return res.status(503).json({ error: 'Set LEDGER_CODE in Vercel' });
  if (!codeEq(req.headers['x-ledger-code'], code)) return res.status(401).json({ error: 'Wrong code' });
  if (!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID)) return res.status(503).json({ error: 'Connect a Blob store in Vercel first' });

  try {
    if (req.method === 'GET') {
      const { blobs } = await list({ prefix: 'inbox/', limit: 1000 });
      const files = blobs.map((b) => ({
        pathname: b.pathname,
        url: b.url,
        size: b.size,
        uploadedAt: b.uploadedAt,
        kind: b.pathname.startsWith('inbox/video/') ? 'video' : 'receipt',
        name: b.pathname.split('/').pop(),
      }));
      return res.status(200).json({ files });
    }

    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    body = body && typeof body === 'object' ? body : {};
    if (body.action !== 'remove') return res.status(400).json({ error: 'Unknown action' });
    const paths = (Array.isArray(body.pathnames) ? body.pathnames : [])
      .map(String).filter((p) => p.startsWith('inbox/') && !p.includes('..')).slice(0, MAX_REMOVE);
    if (!paths.length) return res.status(400).json({ error: 'No valid pathnames' });
    await del(paths);
    return res.status(200).json({ removed: paths.length });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
