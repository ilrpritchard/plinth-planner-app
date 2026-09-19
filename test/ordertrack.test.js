// Order tracking view-model (core/ordertrack.js) + the public-link guarantees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trackingSteps, phaseRows, latestNote, trackURL, orderUnits, TRACK_TOKEN, ORDER_NO } from '../src/core/ordertrack.js';
import { genOrderNo } from '../src/core/orders.js';

const order = (over = {}) => ({
  order_no: 'PL-2609-K7M2', status: 'in_production', placed_at: '2026-09-19T10:00:00Z',
  status_log: [{ at: '2026-09-19T10:00:00Z', status: 'submitted' }, { at: '2026-09-26T09:00:00Z', status: 'confirmed', note: 'Deposit received.' }, { at: '2026-10-05T09:00:00Z', status: 'in_production' }],
  phases: [{ id: 'P1', n: 1, label: 'Show kitchen', units: 1, cabinets: 10, status: 'submitted' }, { id: 'P2', n: 2, label: 'Floors 2 to 6', units: 21, cabinets: 200, status: 'submitted' }],
  phase_status: { P1: 'shipped' },
  unitTypes: [{ name: '1 Bed Type A', units: 12, lines: [] }, { name: '2 Bed Type B', units: 10, lines: [] }],
  ...over,
});

test('the five-step line: done, current, to do, each dated from the log', () => {
  const s = trackingSteps(order());
  assert.deepEqual(s.map((x) => [x.key, x.state]), [['submitted', 'done'], ['confirmed', 'done'], ['in_production', 'current'], ['shipped', 'todo'], ['delivered', 'todo']]);
  assert.equal(s[0].label, 'Quote requested', 'the buyer reads it as a quote request');
  assert.equal(s[1].at, '2026-09-26T09:00:00Z');
  assert.equal(s[3].at, null, 'no date for what has not happened');
  const old = trackingSteps(order({ status_log: [], status: 'confirmed' }));
  assert.equal(old[0].at, '2026-09-19T10:00:00Z', 'an order from before the log still dates its first step from placed_at');
  assert.equal(old[1].at, null);
  assert.ok(trackingSteps(order({ status: 'delivered' })).every((x) => x.state === 'done'), 'delivered: everything done, nothing "current"');
});

test('a cancelled order shows how far it got and nothing as current', () => {
  const s = trackingSteps(order({ status: 'cancelled' }));
  assert.deepEqual(s.map((x) => x.state), ['done', 'done', 'done', 'todo', 'todo']);
});

test('phases carry their own status and progress; the note is the newest one', () => {
  const p = phaseRows(order());
  assert.equal(p[1].statusLabel, 'Not started');   // a phase never reads "Quote requested"
  assert.deepEqual(p.map((x) => [x.id, x.status, x.pct]), [['P1', 'shipped', 75], ['P2', 'submitted', 0]]);
  assert.equal(latestNote(order()).text, 'Deposit received.');
  assert.equal(latestNote(order({ note: 'Fronts in the paint shop.', note_at: '2026-10-14T00:00:00Z' })).text, 'Fronts in the paint shop.');
  assert.equal(latestNote(order({ status_log: [] })), null);
  assert.equal(orderUnits(order()), 22);
});

test('links use the long token, never the order number', () => {
  assert.equal(trackURL('a'.repeat(40), 'https://planner.plinthmade.com/'), `https://planner.plinthmade.com/?order=${'a'.repeat(40)}`);
  assert.ok(TRACK_TOKEN.test('0123456789abcdef0123456789abcdef01234567'));
  for (const bad of ['PL-2609-K7M2', 'short', '', 'g'.repeat(40), '../x']) assert.ok(!TRACK_TOKEN.test(bad), `"${bad}" is not a token`);
  for (let i = 0; i < 50; i++) assert.ok(ORDER_NO.test(genOrderNo()), 'every minted order number matches the pattern the server enforces');
});

test('the public tracking view is built field by field: no prices, customer, designs or findings', () => {
  // the SQL files are local-only (gitignored): check it when it is here, skip on a clean clone
  let sql; try { sql = readFileSync(new URL('../SUPABASE_TRACKING.sql', import.meta.url), 'utf8'); } catch { return; }
  const fn = sql.slice(sql.indexOf('function public.get_order_by_token'), sql.indexOf('revoke all on function public.get_order_by_token'));
  for (const leak of ['customer', 'grand', 'subtotal', 'shipping', 'discount', "'each'", "'total'", 'design', 'specFindings', 'contact_email', 'owner', 'window']) assert.ok(!fn.includes(leak), `tracking view must not expose ${leak}`);
  assert.ok(fn.includes('length(p_token) >= 32'), 'short tokens are refused');
  assert.ok(/find_order[\s\S]*contact_email = lower\(trim\(p_email\)\)/.test(sql), 'find my order needs the email as well as the number');
});
