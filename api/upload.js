// Permission slip for the Upload page (receipt photos and sales videos).
//
// The phone sends the file straight to Vercel Blob (a video is too big for a function body). This endpoint only
// hands back a short-lived signed link good for ONE pathname, one content type and a size limit. The Mac job
// picks the file up, saves it to a permanent folder, checks the size, then deletes it from Blob (see api/uploads.js).
//
// POST { kind: 'video'|'receipt', name, size, type } -> { url, pathname, type }   (url = signed PUT link)
//
// Auth: open by Andrew's choice (internal tool, the URL is only shared with the people who upload; same as
// receipt-inbox "add"). The spending cap is enforced here, before any link is issued: at most MAX_PENDING_FILES
// files / MAX_PENDING_BYTES waiting at once, MAX_FILE_BYTES per file, one content type per link, 15-minute expiry,
// pathname forced under inbox/. Reading and deleting waiting files needs LEDGER_CODE (api/uploads.js).
//
// Required env vars: BLOB_STORE_ID (set by connecting a Blob store; Vercel OIDC auth) or BLOB_READ_WRITE_TOKEN

import { issueSignedToken, presignUrl, list } from '@vercel/blob';
import { randomBytes } from 'node:crypto';

const MAX_FILE_BYTES = 200 * 1024 * 1024; // one video
const MAX_PENDING_FILES = 40;
const MAX_PENDING_BYTES = 1.5 * 1024 * 1024 * 1024;
const LINK_MS = 15 * 60 * 1000;

function safeName(name) {
  // Plain ASCII only: macOS screenshot names carry a narrow no-break space (U+202F) before PM that the signed link cannot match.
  const s = String(name || '').replace(/[\\/]/g, '-').replace(/[^\x20-\x7e]/g, ' ').replace(/[#?%&+=;:@"'<>|*]/g, '-').replace(/\s+/g, ' ').replace(/^\.+/, '').trim().slice(0, 120);
  return s || 'file';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID)) return res.status(503).json({ error: 'Connect a Blob store in Vercel first' });

  try {
    let b = req.body;
    if (typeof b === 'string') b = JSON.parse(b || '{}');
    b = b && typeof b === 'object' ? b : {};

    const kind = b.kind === 'receipt' ? 'receipt' : b.kind === 'video' ? 'video' : '';
    if (!kind) return res.status(400).json({ error: 'Bad kind' });
    const size = Number(b.size);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) return res.status(400).json({ error: 'That file is too big (200 MB max)' });
    const type = String(b.type || '').toLowerCase();
    const okType = kind === 'video' ? /^video\/[a-z0-9.+-]+$/.test(type) : /^image\/[a-z0-9.+-]+$/.test(type);
    if (!okType) return res.status(400).json({ error: kind === 'video' ? 'Choose a video file' : 'Choose a photo' });

    // Cap what can sit in the waiting room.
    const { blobs } = await list({ prefix: 'inbox/', limit: 1000 });
    const bytes = blobs.reduce((s, x) => s + (x.size || 0), 0);
    if (blobs.length >= MAX_PENDING_FILES || bytes + size > MAX_PENDING_BYTES) {
      return res.status(429).json({ error: 'Too many files are waiting. Try again once the Mac has collected them.' });
    }

    // Random suffix before the extension so the link can't be guessed.
    const name = safeName(b.name), dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    const pathname = `inbox/${kind}/${stem}-${randomBytes(5).toString('hex')}${ext}`;

    const validUntil = Date.now() + LINK_MS;
    const tok = await issueSignedToken({ pathname, operations: ['put'], validUntil, allowedContentTypes: [type], maximumSizeInBytes: size });
    const { presignedUrl } = await presignUrl(tok, {
      operation: 'put', pathname, validUntil, allowedContentTypes: [type], maximumSizeInBytes: size,
      addRandomSuffix: false, allowOverwrite: false, access: 'public',
    });
    return res.status(200).json({ url: presignedUrl, pathname, type });
  } catch (e) {
    return res.status(400).json({ error: String((e && e.message) || e) });
  }
}
