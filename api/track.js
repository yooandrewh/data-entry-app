// Records app usage to the "Events" tab of the Google Sheet — which tabs get
// opened, which filters get used, what gets submitted. The tab is created on
// the first successful call, so nothing has to be set up by hand.
//
// What gets stored: a random per-device id generated in localStorage, a coarse
// device label ("iPhone" / "iPad" / "Android" / "Desktop"), the event name and
// a small props object. No names, no IP, no user agent string, nothing that
// identifies a person. The app URL is public, so anyone who opens the link is
// recorded the same anonymous way.
//
// Required env vars: GOOGLE_SA_JSON, SHEET_ID   (optional: APP_KEY, SHEET_EVENTS_TAB)

import { appendRows, ensureTab } from './_sheets.js';

const EVENTS_TAB = process.env.SHEET_EVENTS_TAB || 'Events';
const HEADER = ['Timestamp', 'Date', 'Session', 'Device', 'Event', 'Props'];
const MAX_EVENTS = 40;          // per request — the client batches, it doesn't stream
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
const ymdPT = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);

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
    // sendBeacon posts a Blob, so the body may arrive as a string rather than parsed.
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    if (!body || typeof body !== 'object') body = {};

    const list = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
    if (!list.length) return res.status(200).json({ written: 0 });

    const session = clip(body.session, 40);
    const device = clip(body.device, 20);
    const rows = [];
    for (const e of list) {
      if (!e || !e.name) continue;
      const when = new Date(Number(e.t) > 0 ? Number(e.t) : Date.now());
      rows.push({
        Timestamp: when.toISOString(),
        Date: ymdPT(when),
        Session: session,
        Device: device,
        Event: clip(e.name, 60),
        // Props stay a short JSON blob — one column that can hold anything
        // without the tab growing a new column per event type.
        Props: clip(e.props ? JSON.stringify(e.props) : '', 400),
      });
    }
    if (!rows.length) return res.status(200).json({ written: 0 });

    await ensureTab(EVENTS_TAB, HEADER);
    await appendRows(EVENTS_TAB, rows);
    return res.status(200).json({ written: rows.length });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
