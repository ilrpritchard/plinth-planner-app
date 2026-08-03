// trade-upgrades.test.js — the 2026-07 trade upgrades: panel-ready SKUs,
// stackers (above-tall boxes + ceiling warning), custom RAL finish, volume
// tiers surfacing in docs, show-kitchen-first phasing, hardware supply-only
// language, and the A-600 compliance sheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getCab, CATALOGUE, FINISHES, getFinish, volumeTier, VOLUME_TIERS, sellUSD,
  swapAlternatives,
} from '../src/core/catalogue.js';
import { computeWarnings } from '../src/core/warnings.js';
import { planPhases } from '../src/core/phasing.js';
import { tradeSummary } from '../src/core/cost.js';
import { buildOrderSnapshot, snapshotToTrade } from '../src/core/orders.js';
import { buildInvoiceModel } from '../src/core/invoice.js';
import { buildTradeOrderEmail } from '../src/core/order.js';
import { drawingIndex } from '../src/core/submittal.js';

// ---- panel-ready SKUs -------------------------------------------------------
test('panel-ready column housings T10-T12 exist with housing form + panel notes', () => {
  for (const [code, w] of [['T10', 27], ['T11', 33], ['T12', 39]]) {
    const cab = getCab(code);
    assert.ok(cab, `${code} in catalogue`);
    assert.equal(cab.type, 'TALL');
    assert.equal(cab.form, 'housing', `${code} builds like a housing`);
    assert.equal(cab.w, w);
    assert.equal(cab.h, 86);
    assert.match(cab.notes, /panel-ready/i);
    assert.match(cab.notes, /undrilled/i);
    assert.ok(sellUSD(cab) > 0, `${code} is priced`);
    assert.ok(cab.placeable, `${code} placeable in 3D`);
  }
});

test('F29 undercounter appliance panel is a legless dishwasher-form front', () => {
  const cab = getCab('F29');
  assert.ok(cab, 'F29 in catalogue');
  assert.equal(cab.form, 'dishwasher', 'legless panel — borrows neighbours’ legs like F7');
  assert.equal(cab.type, 'FLOOR');
  assert.match(cab.notes, /panel-ready|undercounter/i);
});

// ---- stackers ---------------------------------------------------------------
test('S-series stackers are hung, flagged, priced, in two heights', () => {
  const stackers = CATALOGUE.filter((c) => c.stacker);
  assert.equal(stackers.length, 32, '7 tall + 5 wall + 4 counter widths × 2 heights');
  for (const cab of stackers) {
    assert.match(cab.code, /^S\d+$/, `${cab.code} is an S-code`);
    assert.equal(cab.type, 'WALL', `${cab.code} is hung (never floor-standing)`);
    assert.ok([84, 86, 86.5].includes(cab.mountY), `${cab.code} mounts on a host top`);
    assert.ok([15, 21].includes(cab.h));
    // depth matches the host family: talls proud → 25.25", wall/counter → 14"
    assert.ok(Math.abs(cab.d - (cab.mountY === 86 ? 25.25 : 14)) < 0.01,
      `${cab.code} depth matches its host family`);
    assert.ok(sellUSD(cab) > 0);
    // desc names the HOST CABINET CODES it fits (her spec), not dimensions
    assert.match(cab.desc, /^Stacker( Double)? \d+" \(fits [A-Z]\d+(, [A-Z]\d+)*\)$/);
    assert.equal(cab.desc.includes('Double'), cab.w >= 30, `${cab.code} door count by width`);
  }
});

test('every stacker desc lists exactly its matching host codes', () => {
  const hostFam = (s) => (s.mountY === 86 ? 'TALL' : s.mountY === 84 ? 'WALL' : 'COUNTER');
  const hosts = CATALOGUE.filter((c) =>
    ['WALL', 'TALL', 'COUNTER'].includes(c.type) && c.placeable && !c.corner && !c.stacker);
  for (const s of CATALOGUE.filter((c) => c.stacker)) {
    const want = hosts.filter((h) => h.type === hostFam(s) && Math.abs(h.w - s.w) < 0.5)
      .map((h) => h.code).join(', ');
    assert.equal(s.desc.match(/\(fits ([^)]+)\)/)[1], want, `${s.code} host list`);
    assert.ok(s.desc.includes(`${s.h}"`), `${s.code} names its own height`);
  }
});

test('EVERY wall/tall/counter cabinet has a stacker that fits it exactly', () => {
  // her spec: "check that all the stackers are the correct size to fit on top
  // of all the wall, tall, counter cabinets" — width equal, mount at the
  // host's top, both heights available. Corners excluded (blank returns).
  const MOUNT = { FLOOR: 0, TALL: 0, WALL: 54, COUNTER: 36.5 };
  const top = (c) => (typeof c.mountY === 'number' ? c.mountY : MOUNT[c.type] ?? 0) + c.h;
  const stackers = CATALOGUE.filter((c) => c.stacker);
  const hosts = CATALOGUE.filter((c) =>
    ['WALL', 'TALL', 'COUNTER'].includes(c.type) && c.placeable && !c.corner && !c.stacker);
  assert.ok(hosts.length >= 25, 'sweep covers the real catalogue');
  for (const host of hosts) {
    for (const h of [15, 21]) {
      const fit = stackers.find((s) =>
        Math.abs(s.w - host.w) < 0.5 && Math.abs(s.mountY - top(host)) < 0.01 && s.h === h);
      assert.ok(fit, `${host.code} (${host.type} w${host.w}, top ${top(host)}") has no ${h}" stacker`);
    }
  }
});

test('stackers never swap with ordinary cabinets or across host families', () => {
  // a 24" wall cabinet must not offer a stacker as an in-place swap…
  assert.ok(!swapAlternatives('W2').some((c) => c.stacker), 'W2 swaps stay non-stacker');
  // …and a tall-host stacker must not offer wall/counter-host stackers
  for (const alt of swapAlternatives('S1')) {
    assert.ok(alt.stacker && alt.mountY === 86, `S1 alt ${alt.code} stays on the tall run`);
  }
  // same width + same host + other height IS a legal swap (S1 24"×15 ↔ S8 24"×21)
  assert.ok(swapAlternatives('S1').some((c) => c.code === 'S8'));
});

test('ceiling warning: a stacker under an 8\' ceiling errors, under 9\' it clears', () => {
  const mk = (height) => ({
    room: { width: 144, depth: 120, height, openings: [] },
    items: [
      { id: 1, code: 'T1', x: -48, z: -48, rotDeg: 0 },
      { id: 2, code: 'S1', x: -48, z: -47.4, rotDeg: 0 },
    ],
  });
  const low = computeWarnings(mk(96));
  assert.ok(low.some((w) => w.level === 'error' && /ceiling/i.test(w.msg) && /S1/.test(w.msg)),
    '86+15=101" stacker flagged under a 96" ceiling');
  const high = computeWarnings(mk(108));
  assert.ok(!high.some((w) => /ceiling/i.test(w.msg)), 'clears under a 9\' ceiling');
});

// ---- custom RAL finish ------------------------------------------------------
test('Custom RAL finish exists and getFinish resolves it', () => {
  const f = FINISHES.find((x) => x.name === 'Custom RAL');
  assert.ok(f, 'Custom RAL in FINISHES');
  assert.ok(f.custom, 'flagged custom');
  assert.equal(getFinish('Custom RAL').name, 'Custom RAL');
});

// ---- volume tiers ----------------------------------------------------------
test('volumeTier boundaries', () => {
  assert.equal(volumeTier(9), null);
  assert.equal(volumeTier(10).pct, 3);
  assert.equal(volumeTier(25).pct, 5);
  assert.equal(volumeTier(50).pct, 8);
  assert.equal(volumeTier(100).pct, 10);
  assert.equal(volumeTier(500).pct, 10);
  assert.ok(VOLUME_TIERS.every((t) => t.pct > 0 && t.pct < 100));
});

test('discount is cent-exact and flows through snapshot → invoice', () => {
  const trade = {
    project: 'Tower', finish: 'Custom RAL', finishRal: '9010',
    address: '1 Main St, New York, NY', architect: 'Arch LLP', gc: 'GC Inc', owner: 'Dev LLC',
    units: [{ id: 1, beds: '1 Bed', letter: 'A', qty: 60, rows: [{ id: 1, code: 'F2', qty: 4 }, { id: 2, code: 'W2', qty: 2 }] }],
  };
  const s = tradeSummary(trade);
  assert.equal(Math.round(s.discount * 100), s.discount * 100, 'discount lands on exact cents');
  assert.ok(Math.abs(s.grand - (s.subtotal - s.discount + s.shipping)) < 1e-6);

  const snap = buildOrderSnapshot(trade, { now: 1780000000000 });
  assert.equal(snap.totals.discount, s.discount);
  assert.equal(snap.totals.tier.pct, 8);
  assert.equal(snap.projectMeta.architect, 'Arch LLP');
  assert.equal(snap.finishRal, '9010');

  // round-trips through the snapshot adapter
  const back = snapshotToTrade(snap);
  assert.equal(back.architect, 'Arch LLP');
  assert.equal(back.finishRal, '9010');

  // invoice foots: charges (discount + shipping) reconcile subtotal → grand
  const inv = buildInvoiceModel(snap, { kind: 'deposit', now: 1780000000000 });
  const chargeSum = inv.charges.reduce((x, c) => x + c.amountCents, 0);
  assert.equal(inv.totals.subtotalCents + chargeSum, inv.totals.grandCents, 'invoice maths foots with the tier credit');
  assert.ok(inv.charges.some((c) => /volume tier/i.test(c.label) && c.amountCents < 0));
});

// ---- show kitchen first -----------------------------------------------------
test('show-kitchen-first phasing pulls one unit into an early phase', () => {
  const trade = {
    units: [{ id: 1, beds: '1 Bed', letter: 'A', floorFrom: 1, floorTo: 10, perFloor: 4, rows: [{ id: 1, code: 'F2', qty: 5 }] }],
    phasing: { on: true, maxPerBatch: 20 },
  };
  const base = planPhases(trade, { maxUnitsPerBatch: 20 });
  const show = planPhases(trade, { maxUnitsPerBatch: 20, showKitchenFirst: true });
  assert.equal(show.batches[0].units, 1, 'phase 1 is the single show kitchen');
  assert.ok(show.batches[0].showKitchen);
  assert.match(show.batches[0].label, /show kitchen/i);
  const total = (plan) => plan.batches.reduce((x, b) => x + b.units, 0);
  assert.equal(total(show), total(base), 'no units created or lost');
  const cabsTotal = (plan) => plan.batches.reduce((x, b) => x + b.cabinets, 0);
  assert.equal(cabsTotal(show), cabsTotal(base), 'no cabinets created or lost');
  assert.equal(show.batches[0].n, 1, 'phases renumber from the show kitchen');
});

test('show-kitchen-first is a no-op for a single-unit order', () => {
  const trade = { units: [{ id: 1, qty: 1, rows: [{ id: 1, code: 'F2', qty: 5 }] }], phasing: { on: true } };
  const show = planPhases(trade, { showKitchenFirst: true });
  assert.equal(show.batches.length, 1);
  assert.ok(!show.batches[0].showKitchen);
});

// ---- hardware supply-only + trade email meta ---------------------------------
test('trade order email carries directory, RAL, tier and undrilled hardware', () => {
  const state = {
    trade: {
      project: 'Tower', address: '1 Main St', architect: 'Arch LLP', gc: 'GC Inc', owner: 'Dev LLC',
      finish: 'Custom RAL', finishRal: '9010',
      units: [{ id: 1, beds: '1 Bed', letter: 'A', qty: 60, rows: [{ id: 1, code: 'F2', qty: 4 }] }],
    },
    customer: { name: 'I', email: 'i@x.com', notes: '' },
  };
  const mail = buildTradeOrderEmail(state);
  assert.match(mail.body, /Architect: Arch LLP/);
  assert.match(mail.body, /RAL 9010/);
  assert.match(mail.body, /Volume tier 50–99 units \(indicative -8%\)/);
  assert.match(mail.body, /supplied undrilled/);
  assert.doesNotMatch(mail.body, /Handles: knob/);
});

// ---- compliance sheet in the index -------------------------------------------
test('drawing index carries the A-600 compliance sheet', () => {
  const design = { room: { width: 144, depth: 120, height: 96, openings: [] }, items: [{ id: 1, code: 'F2', x: 0, z: -47.5, rotDeg: 0 }] };
  const idx = drawingIndex(design);
  assert.ok(idx.some((d) => d.no === 'A-600' && /COMPLIANCE/.test(d.title)));
});

// ---- worktop appliance clamp: notch, never edge-shave ------------------------
test('corner slab near a range loses only the notch — never the whole run front', async () => {
  // Imogen's real 2026-07-16 layout: L-kitchen, range 22" off the side wall,
  // 24"-deep left run turning the corner. The old edge-shave stripped the
  // front 3.2" off the ENTIRE 15-ft run ("worktop not deep enough").
  const { planWorktopSlabs } = await import('../src/core/worktop-plan.js');
  const room = { width: 144, depth: 180 };
  let id = 1;
  const I = (code, x, z, rot = 0) => ({ id: id++, code, x, z, rotDeg: rot });
  const items = [
    I('F17', -60, -77.8), I('AP1', -35, -77), I('F21', -10, -76), I('F2', 12, -76), I('F7', 36, -76),
    I('F3', -59.8, -50, 90), I('F3', -59.8, -22, 90), I('F3', -59.8, 6, 90), I('F3', -59.8, 34, 90),
  ];
  const slabs = planWorktopSlabs(items, getCab, 'marble', room);
  const covered = (x, z) => slabs.some((s) =>
    x >= s.x0 - 0.01 && x <= s.x1 + 0.01 && z >= s.z0 - 0.01 && z <= s.z1 + 0.01);
  assert.ok(covered(-48.2, 6), 'run front mid-body stays covered (fronts + overhang)');
  assert.ok(covered(-48.2, 34), 'run front far from the corner stays covered');
  assert.ok(covered(-69, -80), 'corner square over the back-run cabinet stays covered');
  assert.ok(!covered(-35, -77), 'no slab rides over the range');
  assert.ok(!covered(-35, -63.5), 'the 1" lip stops dead at the range — never across its front');
});
