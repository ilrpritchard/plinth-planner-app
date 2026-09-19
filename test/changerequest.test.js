// Change requests: a buyer asks, PL/NTH approves; the order snapshot stays frozen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoUnits } from '../src/core/tradedemo.js';
import { buildOrderSnapshot } from '../src/core/orders.js';
import { buildInvoiceModel } from '../src/core/invoice.js';
import {
  startProposal, buildChangeRequest, canRequestChange, currentOrderRow, invoiceChanges, nextChangeSeq,
} from '../src/core/changerequest.js';

const NOW = Date.UTC(2026, 8, 19);
function makeOrder(status = 'confirmed') {
  const trade = { project: 'Harbor Row', finish: 'Hudson', units: buildDemoUnits().units, phasing: { on: false } };
  const data = buildOrderSnapshot(trade, { now: NOW, customer: { name: 'Dev', email: 'dev@example.com' } });
  return { id: 'o1', order_no: 'PL-2609-UKYK', status, placed_at: new Date(NOW).toISOString(), data };
}

test('a request stores the revised spec and a frozen change-order model', () => {
  const order = makeOrder();
  const p = startProposal(order, []);
  assert.equal(p.units.length, 3);
  p.units[0].rows.push({ code: 'F18', qty: 1 });          // add a drawer bank to type A
  p.units[2].qty += 2;                                     // two more C units
  const req = buildChangeRequest(order, [], p, { now: NOW });
  assert.equal(req.seq, 1);
  assert.equal(req.model.changeLabel, 'Change 1');
  assert.equal(req.model.changes.length, 2);
  assert.ok(req.model.totals.netDeltaCents > 0);
  assert.equal(req.proposal.units[0].rev, 'B', 'changed cabinet lines move the type to its next revision');
  assert.equal(req.proposal.units[2].rev, 'A', 'a unit-count change alone does not');
  assert.deepEqual(JSON.parse(JSON.stringify(req.model)), req.model, 'the model is plain data (stored as jsonb)');
});

test('nothing changed, everything removed, wrong status, already pending: refused with a reason', () => {
  const order = makeOrder();
  assert.match(buildChangeRequest(order, [], startProposal(order, []), { now: NOW }).error, /Nothing has changed/);
  const none = startProposal(order, []); none.units.forEach((u) => { u.qty = 0; });
  assert.match(buildChangeRequest(order, [], none, { now: NOW }).error, /every cabinet/);
  assert.equal(canRequestChange(makeOrder('shipped'), []).ok, false);
  assert.equal(canRequestChange(makeOrder('cancelled'), []).ok, false);
  assert.equal(canRequestChange(order, [{ seq: 1, status: 'pending' }]).ok, false);
  assert.equal(canRequestChange(order, [{ seq: 1, status: 'declined' }]).ok, true);
});

test('duplicate rows merge, zero and unknown codes drop out', () => {
  const order = makeOrder();
  const p = startProposal(order, []);
  p.units[0].rows.push({ code: 'F10', qty: 1 }, { code: 'NOPE', qty: 3 }, { code: 'F18', qty: 0 });
  const req = buildChangeRequest(order, [], p, { now: NOW });
  const f10 = req.proposal.units[0].rows.filter((r) => r.code === 'F10');
  assert.equal(f10.length, 1); assert.equal(f10[0].qty, 2);
  assert.ok(!req.proposal.units[0].rows.some((r) => r.code === 'NOPE' || r.code === 'F18'));
});

test('change 2 is measured against the order AFTER approved change 1, so approved deltas add up', () => {
  const order = makeOrder();
  const p1 = startProposal(order, []); p1.units[0].rows.push({ code: 'F18', qty: 1 });
  const c1 = { ...buildChangeRequest(order, [], p1, { now: NOW }), status: 'approved' };
  const p2 = startProposal(order, [c1]);
  assert.ok(p2.units[0].rows.some((r) => r.code === 'F18'), 'the next request starts from the approved spec');
  p2.units[1].qty += 1;
  const c2 = { ...buildChangeRequest(order, [c1], p2, { now: NOW }), status: 'approved' };
  assert.equal(c2.seq, 2); assert.equal(nextChangeSeq([c1, c2]), 3);
  assert.equal(c2.model.changes.length, 1, 'change 2 does not re-list change 1');
  // a DECLINED change never moves the base
  const declined = { ...c1, status: 'declined' };
  assert.equal(currentOrderRow(order, [declined]), order);
  // from-scratch check: original -> final in one step equals change 1 + change 2
  const direct = buildChangeRequest(order, [], p2, { now: NOW });
  assert.equal(direct.model.totals.netDeltaCents, c1.model.totals.netDeltaCents + c2.model.totals.netDeltaCents);
});

test('approved changes land on the BALANCE invoice, cents-exact; the deposit never moves', () => {
  const order = makeOrder();
  const p1 = startProposal(order, []); p1.units[0].rows.push({ code: 'F18', qty: 1 });
  const c1 = { ...buildChangeRequest(order, [], p1, { now: NOW }), status: 'approved' };
  const pend = { seq: 2, status: 'pending', model: { totals: { netDeltaCents: 999999 } } };
  const ch = invoiceChanges([c1, pend]);
  assert.equal(ch.length, 1, 'only approved changes are billed');
  const dep0 = buildInvoiceModel(order, { kind: 'deposit', now: NOW }), bal0 = buildInvoiceModel(order, { kind: 'balance', now: NOW });
  const dep = buildInvoiceModel(order, { kind: 'deposit', now: NOW, changes: ch }), bal = buildInvoiceModel(order, { kind: 'balance', now: NOW, changes: ch });
  assert.equal(dep.amountDueCents, dep0.amountDueCents);
  assert.equal(bal.amountDueCents, bal0.amountDueCents + c1.model.totals.netDeltaCents);
  assert.equal(bal.totals.revisedGrandCents, bal0.totals.grandCents + c1.model.totals.netDeltaCents);
  assert.equal(dep.amountDueCents + bal.amountDueCents, bal.totals.revisedGrandCents);
});
