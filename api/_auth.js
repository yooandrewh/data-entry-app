// Shared access-code check for every write endpoint.
// The code lives in env LEDGER_CODE and is sent as the x-ledger-code header.
// Deny by default: with no LEDGER_CODE set, writes are refused (503); a wrong or missing code is refused (401).
import { timingSafeEqual } from 'node:crypto';

// Constant-time comparison, so response time never hints at how much of a guess was right.
export function codeEq(got, want) {
  const a = Buffer.from(String(got == null ? '' : got));
  const b = Buffer.from(String(want == null ? '' : want));
  return a.length === b.length && timingSafeEqual(a, b);
}

// Returns true when the request may write. Otherwise it has already sent the 503 / 401 and returns false.
export function requireCode(req, res) {
  const code = process.env.LEDGER_CODE;
  if (!code) { res.status(503).json({ error: 'Set LEDGER_CODE in Vercel to enable writes' }); return false; }
  if (!codeEq(req.headers['x-ledger-code'], code)) { res.status(401).json({ error: 'Wrong code' }); return false; }
  return true;
}
