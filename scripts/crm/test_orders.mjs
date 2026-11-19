// Exercises api/orders.js with a fake req/res. Nothing here reaches Google (auth and validation fail first;
// the one valid POST runs with no Google credentials set, so it must end in a generic 500).
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
delete process.env.GOOGLE_SA_JSON; delete process.env.SHEET_ID;
const here = path.dirname(fileURLToPath(import.meta.url));
const { default: handler } = await import(path.join(here, '../../api/orders.js'));

async function call(method, headers = {}, body) {
  let status = 0, json = null; const h = {};
  const res = { setHeader: (k, v) => { h[k] = v; }, status(c) { status = c; return this; }, json(j) { json = j; return this; }, end() { return this; } };
  await handler({ method, headers, body }, res);
  return { status, json, h };
}
const okRow = ['LM-1', '2026-11-04', '10:32', 'La Mirada', 'Fake Cashier', 'Fake Name', '(555) 010-0000', 'Cash', 9.5, '', 2, 1, 'Lemon:1', 'Baked goods'];
const order = [...okRow, 'src'];

delete process.env.LEDGER_CODE;
assert.equal((await call('GET')).status, 503);
assert.equal((await call('POST', { 'x-ledger-code': 'x' }, {})).status, 503);
process.env.LEDGER_CODE = 'test-code';
assert.equal((await call('PUT')).status, 405);
assert.equal((await call('OPTIONS')).status, 204);
let r = await call('GET'); assert.equal(r.status, 401);
r = await call('GET', { 'x-ledger-code': 'wrong' }); assert.equal(r.status, 401);
r = await call('POST', {}, { action: 'replace', tab: 'Orders', rows: [order] }); assert.equal(r.status, 401);
const H = { 'x-ledger-code': 'test-code' };
assert.equal((await call('POST', H, '{not json')).status, 400);
assert.equal((await call('POST', H, { action: 'wipe' })).status, 400);
assert.equal((await call('POST', H, { action: 'replace', tab: 'Pantry', rows: [order] })).status, 400);
assert.equal((await call('POST', H, { action: 'replace', tab: '__proto__', rows: [order] })).status, 400);
assert.equal((await call('POST', H, { action: 'replace', tab: 'Orders', rows: [] })).status, 400);
r = await call('POST', H, { action: 'replace', tab: 'Orders', rows: [order.slice(1)] });
assert.equal(r.status, 400); assert.ok(!JSON.stringify(r.json).includes('Fake'));
assert.equal((await call('POST', H, { action: 'replace', tab: 'Orders', rows: [[...order.slice(0, 5), { x: 1 }, ...order.slice(6)]] })).status, 400);
assert.equal((await call('POST', H, { action: 'replace', tab: 'OrderItems', rows: Array(20001).fill(['a', 'b', 'c', 1, 1, 'd', 'e']) })).status, 400);
// valid body but no Google credentials: generic 500, nothing echoed
r = await call('POST', H, { action: 'replace', tab: 'Orders', rows: [order] });
assert.equal(r.status, 500); assert.deepEqual(r.json, { error: 'Server error' });
r = await call('GET', H); assert.equal(r.status, 500); assert.deepEqual(r.json, { error: 'Server error' });
assert.equal(r.h['Cache-Control'], 'no-store');
console.log('orders.js handler checks passed');

// Second copy of the handler with the Sheets client replaced by an in-memory stub, to check what gets written and read back.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-test-'));
fs.writeFileSync(path.join(dir, '_sheets.js'), `
export const store = {};
export async function ensureTab() {}
export async function replaceTab(tab, header, rows) { store[tab] = { header, rows }; }
export async function getRows(tab) {
  const t = store[tab]; if (!t) return { header: [], rows: [] };
  return { header: t.header, rows: t.rows.slice(1).map((r, i) => Object.fromEntries([['_row', i + 2], ...t.header.map((h, c) => [h, r[c] === undefined ? '' : r[c]])])) };
}`);
fs.copyFileSync(path.join(here, '../../api/_auth.js'), path.join(dir, '_auth.js'));
fs.writeFileSync(path.join(dir, 'orders.js'), fs.readFileSync(path.join(here, '../../api/orders.js'), 'utf8'));
const h2 = (await import(path.join(dir, 'orders.js'))).default;
const st = await import(path.join(dir, '_sheets.js'));
async function call2(method, headers, body) {
  let status = 0, json = null;
  await h2({ method, headers, body }, { setHeader() {}, status(c) { status = c; return this; }, json(j) { json = j; return this; }, end() { return this; } });
  return { status, json };
}
const evil = ['LM-2', '2026-11-05', '09:00', 'La Mirada', 'c', '=HYPERLINK("x")', '(555) 010-0001', 'Cash', '12.5', '', 1, 0, 'x'.repeat(500), '', ''];
r = await call2('POST', H, { action: 'replace', tab: 'Orders', rows: [order, evil] });
assert.equal(r.status, 200); assert.equal(r.json.written, 2);
assert.equal(st.store.Orders.rows[0][0], 'Id');
assert.equal(st.store.Orders.rows[2][5], "'=HYPERLINK(\"x\")");
assert.equal(st.store.Orders.rows[2][8], 12.5);
assert.equal(st.store.Orders.rows[2][12].length, 300);
r = await call2('POST', H, { action: 'replace', tab: 'OrderItems', rows: [['LM-1', 'Madeleine', '', 1, 2.5, 'Baked goods', 'Lemon'], ['LM-1', 'Tea', 'oat', 2, '', 'Drink', '']] });
assert.equal(r.status, 200);
r = await call2('GET', H);
assert.equal(r.status, 200); assert.equal(r.json.orders.length, 2);
const o1 = r.json.orders[0];
assert.equal(o1.total, 9.5); assert.equal(o1.fee, null); assert.equal(o1.items.length, 2);
assert.equal(o1.items[0].price, 2.5); assert.equal(o1.items[1].price, null);
assert.equal(r.json.orders[1].customer, '=HYPERLINK("x")'); // apostrophe guard removed on the way out
assert.equal(r.json.orders[1].items.length, 0);
fs.rmSync(dir, { recursive: true, force: true });
console.log('orders.js stubbed write/read checks passed');
