// Upload token for the Upload page (receipt photos and sales videos).
//
// The phone sends the file straight to Vercel Blob (a video is too big for a function body); this
// endpoint only decides whether the phone may do that, and under what limits. The Mac job picks the
// file up, saves it to a permanent folder, checks the size, then deletes it from Blob (see api/uploads.js).
//
// POST (used by @vercel/blob/client `upload()`): { type: 'blob.generate-client-token', payload: {...} }
//
// Auth: the client payload (the upload code typed on the Upload page) must match env UPLOAD_CODE (a separate code for the person who uploads, never
// LEDGER_CODE). With no UPLOAD_CODE set, uploads are refused (503).
// Cost cap: the token is refused when too many files are waiting or the waiting files are too big,
// and every token carries a per-file size limit, an allowed content type, and a pathname that must start with inbox/.
//
// Required env vars: BLOB_READ_WRITE_TOKEN (set by connecting a Blob store), UPLOAD_CODE

import { handleUpload } from '@vercel/blob/client';
import { list } from '@vercel/blob';

const MAX_FILE_BYTES = 200 * 1024 * 1024; // one video
const MAX_PENDING_FILES = 40;
const MAX_PENDING_BYTES = 1.5 * 1024 * 1024 * 1024;
const PREFIXES = ['inbox/video/', 'inbox/receipt/'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const code = process.env.UPLOAD_CODE;
  if (!code) return res.status(503).json({ error: 'Set UPLOAD_CODE in Vercel to enable uploads' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'Connect a Blob store in Vercel first' });

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    body = body && typeof body === 'object' ? body : {};

    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // The upload code travels as the client payload; Vercel's own completion callback carries none, so check it here.
        if (clientPayload !== code) throw new Error('Wrong code');
        if (!PREFIXES.some((p) => pathname.startsWith(p)) || pathname.includes('..')) {
          throw new Error('Bad file path');
        }
        // Cap what can sit in the waiting room.
        const { blobs } = await list({ prefix: 'inbox/', limit: 1000 });
        const bytes = blobs.reduce((s, b) => s + (b.size || 0), 0);
        if (blobs.length >= MAX_PENDING_FILES || bytes >= MAX_PENDING_BYTES) {
          throw new Error('Too many files are waiting. Try again once the Mac has collected them.');
        }
        return {
          allowedContentTypes: ['video/*', 'image/*'],
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(400).json({ error: String((e && e.message) || e) });
  }
}
