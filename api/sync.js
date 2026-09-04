// Vercel serverless function: receives an entry from the app and appends a row to
// the matching tab of the Google Sheet — Deliveries or Inventory, routed by `type`.
// The service-account key lives ONLY here (server-side), never in the client.
//
// Required env vars (set in Vercel project settings):
//   GOOGLE_SA_JSON  - the service-account key JSON, base64-encoded
//   SHEET_ID        - the spreadsheet id
// Optional env vars:
//   SHEET_DELIVERIES_TAB / SHEET_INVENTORY_TAB - tab name overrides
//   APP_KEY         - if set, requests must send a matching "x-app-key" header
//   NTFY_TOPIC      - ntfy.sh topic for phone push notifications

import crypto from 'node:crypto';
import { appendRow, sheetId } from './_sheets.js';

const DELIVERIES_TAB = process.env.SHEET_DELIVERIES_TAB || 'Deliveries';
const TAB_BY_TYPE = {
  delivery: DELIVERIES_TAB,
  inventory: process.env.SHEET_INVENTORY_TAB || 'Inventory',
  // Goodwill = free samples given out. Stored in the Deliveries tab as a NEGATIVE
  // stock adjustment so it subtracts from on-hand (and from projections).
  goodwill: DELIVERIES_TAB,
  // Transfer = moving stock between stores. Written as TWO Deliveries-tab rows:
  // a negative one at the source and a positive one at the destination.
  transfer: DELIVERIES_TAB,
};

// App product name -> Sheet column name.
const PRODUCT_MAP = {
  'Lemon Poppy': 'Lemon Poppy',
  'Sea Salt': 'Sea Salt Butter',
  'Ube': 'Ube',
  'Dot': 'Dot',
  'Earl Grey': 'Earl Grey',
  'Dubai Ball': 'Dubai Ball',
};

// Allowed locations (must match the Select column values in the sheet).
const ALLOWED_LOCATIONS = ['La Mirada', 'Stanton'];

// Coerce an amount to a safe integer (caps absurd values). Negatives are allowed
// so the app can record stock removals (goodwill samples / manual adjustments).
function cleanAmount(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1000000, Math.min(n, 1000000));
}

// Turn a local wall-clock "YYYY-MM-DDTHH:MM" into a full ISO datetime with the
// correct America/Los_Angeles offset (handles PST -08:00 vs PDT -07:00). Returns
// null if the input is malformed.
function laDateTime(local) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(local))) return null;
  const asUTC = new Date(local + ':00Z');
  const tzName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', timeZoneName: 'longOffset',
  }).formatToParts(asUTC).find((p) => p.type === 'timeZoneName').value; // e.g. "GMT-07:00"
  const m = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  const offset = m ? `${m[1]}${m[2].padStart(2, '0')}:${m[3] || '00'}` : 'Z';
  return `${local}:00${offset}`;
}

// Best-effort phone push via ntfy.sh. Never blocks/fails the sync.
async function sendNotification({ type, location, to, dateOnly, amounts }) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const t = String(type).toLowerCase();
  const isGoodwill = t === 'goodwill', isXfer = t === 'transfer';
  const parts = Object.keys(PRODUCT_MAP)
    .map((p) => { const n = Math.abs(cleanAmount(amounts[p])); return n > 0 ? `${p} ${n}` : null; })
    .filter(Boolean);
  const lead = isGoodwill ? 'Samples out: ' : isXfer ? 'Moved: ' : '';
  const body = `${lead}${parts.length ? parts.join(', ') : 'No amounts'} · ${dateOnly}`;
  const tag = isGoodwill ? 'gift' : isXfer ? 'arrows_counterclockwise' : (type === 'delivery' ? 'truck' : 'package');
  const title = isXfer ? `Transfer - ${location} -> ${to}` : `${cap(type)} - ${location}`;  // ASCII only (HTTP header)
  await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: { 'Title': title, 'Tags': tag },
    body,
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (process.env.APP_KEY && req.headers['x-app-key'] !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { type, datetime, location, amounts } = req.body || {};
    if (!type || !location || !datetime) {
      return res.status(400).json({ error: 'Missing required fields (type, datetime, location)' });
    }

    const tab = TAB_BY_TYPE[String(type).toLowerCase()];
    if (!tab) return res.status(400).json({ error: `Unknown type: ${type}` });

    if (!ALLOWED_LOCATIONS.includes(location)) {
      return res.status(400).json({ error: `Unknown location: ${location}` });
    }

    // Store the full date + time (with the right PST/PDT offset).
    const startIso = laDateTime(datetime);
    if (!startIso) return res.status(400).json({ error: `Invalid datetime: ${datetime}` });
    const dateOnly = String(datetime).split('T')[0]; // for the short push text

    const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
    const a = (amounts && typeof amounts === 'object') ? amounts : {};
    const isGoodwill = String(type).toLowerCase() === 'goodwill';

    // ---- Transfer: two linked rows (out of source, into destination) ----
    if (String(type).toLowerCase() === 'transfer') {
      const to = req.body && req.body.to;
      if (!ALLOWED_LOCATIONS.includes(to) || to === location) {
        return res.status(400).json({ error: `Invalid transfer destination: ${to}` });
      }
      const mkRow = (rowId, sel, notes, sign) => {
        const r = { id: rowId, Date: startIso, Select: sel, 'Tagged for deletion': 'FALSE', notes };
        for (const [appName, colName] of Object.entries(PRODUCT_MAP)) {
          r[colName] = sign * Math.abs(cleanAmount(a[appName]));
        }
        return r;
      };
      const srcId = crypto.randomUUID(), dstId = crypto.randomUUID();
      await appendRow(DELIVERIES_TAB, mkRow(srcId, location, `Transfer → ${to}`, -1));
      await appendRow(DELIVERIES_TAB, mkRow(dstId, to, `Transfer ← ${location}`, +1));
      await sendNotification({ type, location, to, dateOnly, amounts: a }).catch(() => {});
      const url = `https://docs.google.com/spreadsheets/d/${sheetId()}/edit`;
      return res.status(200).json({ ok: true, id: srcId, ids: [srcId, dstId], url });
    }

    const id = crypto.randomUUID();

    // Build the row object; appendRow() orders it to match the tab's header.
    const row = {
      id,
      Date: startIso,
      Select: location,
      'Tagged for deletion': 'FALSE',
      notes: `${cap(type)} — ${location}`,
    };
    for (const [appName, colName] of Object.entries(PRODUCT_MAP)) {
      // Goodwill removes stock: always store a negative number regardless of sign entered.
      const n = cleanAmount(a[appName]);
      row[colName] = isGoodwill ? -Math.abs(n) : n;
    }

    await appendRow(tab, row);

    // Push a phone notification (best-effort — a failure here never fails the sync).
    await sendNotification({ type, location, dateOnly, amounts: a }).catch(() => {});

    const url = `https://docs.google.com/spreadsheets/d/${sheetId()}/edit`;
    return res.status(200).json({ ok: true, id, url });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
