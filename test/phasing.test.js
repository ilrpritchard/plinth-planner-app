// Delivery phasing: floor banding, batch caps, week offsets, CSV feed.
import { planPhases, batchWindow, phasesForUnit, cabsPerUnit, DEFAULT_MAX_PER_BATCH, WEEKS_BETWEEN_BATCHES } from '../src/core/phasing.js';
import { deliveryEstimate } from '../src/core/cost.js';
import { buildTradeOrderCSV } from '../src/core/tradecsv.js';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };

const rows = (n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: i + 1, code: 'F2', qty: 1 });
  return out;
};

// ---- a 30-floor tower: 4 units/floor of one type → 120 units --------------------
const tower = {
  project: 'Rough-In Tower', finish: 'Ghost', nextUnitId: 2, nextRowId: 200,
  units: [{ id: 1, beds: '1 Bed', letter: 'A', name: '', qty: 0, floorFrom: 1, floorTo: 30, perFloor: 4, rows: rows(6) }],
};
const plan = planPhases(tower);
ok('default max 20/batch', plan.maxPerBatch === DEFAULT_MAX_PER_BATCH);
ok('120 units → 6 batches of 20', plan.batches.length === 6 && plan.batches.every((b) => b.units === 20));
ok('every batch ≤ max', plan.batches.every((b) => b.units <= plan.maxPerBatch));
ok('floor bands of 5 floors', plan.batches[0].label === 'Floors 1–5' && plan.batches[5].label === 'Floors 26–30');
ok('bands are contiguous, no gaps or overlaps', plan.batches.every((b, i) =>
  i === 0 || b.floors[0] === plan.batches[i - 1].floors[1] + 1));
ok('bands cover floors 1–30', plan.batches[0].floors[0] === 1 && plan.batches[5].floors[1] === 30);
ok('cabinets per batch = units × cab/unit', plan.batches.every((b) => b.cabinets === b.units * 6));
ok('totalCabs = 720', plan.totalCabs === 720);

// week offsets: batch 1 on the whole-order estimate, +2wk per later batch
const base = deliveryEstimate(720);
ok('batch 1 ships on the whole-order lead time (>80 cabs → 16–18wk)', plan.batches[0].weeksLo === base.weeksLo && plan.batches[0].weeksHi === base.weeksHi && base.weeksLo === 16);
ok('batch n ships +2wk after batch n−1', plan.batches.every((b, i) =>
  b.weeksLo === base.weeksLo + i * WEEKS_BETWEEN_BATCHES && b.weeksHi === base.weeksHi + i * WEEKS_BETWEEN_BATCHES));
const w1 = batchWindow(plan.batches[0], Date.UTC(2026, 6, 8));
ok('batchWindow formats a dated range', /2026|2027/.test(w1.from) && /2026|2027/.test(w1.to));

// ---- smaller cap → more, still-capped batches ----
const plan10 = planPhases(tower, { maxUnitsPerBatch: 10 });
ok('cap 10 → 2-floor bands of 8 → 15 batches', plan10.batches.length === 15 && plan10.batches.every((b) => b.units === 8));
ok('cap 10 respected', plan10.batches.every((b) => b.units <= 10));
ok('bands stay contiguous at cap 10', plan10.batches.every((b, i) => i === 0 || b.floors[0] === plan10.batches[i - 1].floors[1] + 1));

// a cap below one floor's units still moves forward (one floor per batch)
const plan2 = planPhases(tower, { maxUnitsPerBatch: 2 });
ok('cap below per-floor: one floor per batch, no infinite loop', plan2.batches.length === 30 && plan2.batches.every((b) => b.floors[0] === b.floors[1]));

// ---- mixed unit types on overlapping floors ----
const mixed = {
  units: [
    { id: 1, beds: '1 Bed', letter: 'A', qty: 0, floorFrom: 1, floorTo: 10, perFloor: 3, rows: rows(5) },
    { id: 2, beds: '2 Bed', letter: 'B', qty: 0, floorFrom: 6, floorTo: 12, perFloor: 2, rows: rows(8) },
    { id: 3, beds: 'Penthouse', letter: 'C', qty: 2, floorFrom: '', floorTo: '', perFloor: '', rows: rows(12) },
  ],
};
const mp = planPhases(mixed, { maxUnitsPerBatch: 12 });
const totalUnits = mp.batches.reduce((t, b) => t + b.units, 0);
ok('mixed: every unit lands in exactly one batch (30+14+2)', totalUnits === 46);
ok('mixed: overlapping floors carry both types', mp.batches.some((b) => b.byType.length === 2));
ok('mixed: floorless type gets its own trailing batch', mp.batches[mp.batches.length - 1].floors === null && mp.batches[mp.batches.length - 1].byType[0].name.includes('Penthouse'));
ok('mixed: batches ≤ 12', mp.batches.every((b) => b.units <= 12));
ok('cabsPerUnit reads supplied rows', cabsPerUnit(mixed.units[2]) === 12);
ok('phasesForUnit: 2 Bed B spans its floor batches only', (() => {
  const ph = phasesForUnit(mp, mixed.units[1]);
  return ph.length >= 1 && ph.every((n) => mp.batches[n - 1].byType.some((t) => t.name.includes('2 Bed')));
})());

// ---- CSV: phase column appended only when phasing is on ----
const csvOff = buildTradeOrderCSV(tower);
ok('CSV without phasing: original header untouched', csvOff.startsWith('Unit type,Floors / qty,') && !csvOff.includes('Delivery phase'));
const towerPhased = { ...tower, phasing: { on: true, maxPerBatch: 20 } };
const csvOn = buildTradeOrderCSV(towerPhased, Date.UTC(2026, 6, 8));
const head = csvOn.split('\r\n')[0];
ok('CSV with phasing: Delivery phase APPENDED as the last column', head.endsWith(',Delivery phase') && head.startsWith('Unit type,Floors / qty,'));
ok('CSV lines carry the phase list', csvOn.includes('1 2 3 4 5 6'));
ok('CSV gains a DELIVERY PHASING block (ASCII floors label)', csvOn.includes('DELIVERY PHASING') && csvOn.includes('Phase 1,Floors 1-5'));
ok('CSV phasing block has dated windows', /Phase 6,Floors 26-30,.*\d{4}/.test(csvOn));

console.log(`\nphasing.test.js — ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
