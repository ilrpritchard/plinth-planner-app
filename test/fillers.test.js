// Auto-filler: gap detection + cost inclusion.
import { computeFillers } from '../src/core/fillers.js';
import { summarize } from '../src/core/cost.js';
import { getCab, sellUSD, FILLER_SELL } from '../src/core/catalogue.js';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };

const room = { width: 144, depth: 120, floor: 'oak', wall: 'chalk', worktop: 'marble' };
const Z = -120 / 2 + 24 / 2 + 0.25; // back-wall z for a 24"-deep base cab

// run nearly reaches the LEFT wall (3" gap) -> one filler
const s1 = { room, items: [{ id: 1, code: 'F2', x: -57, z: Z, rotDeg: 0 }] };
const f1 = computeFillers(s1);
ok('one filler detected', f1.length === 1);
ok('filler width ≈ 3"', Math.abs(f1[0].w - 3) < 0.01);
ok('filler against back run (rot 0)', f1[0].rotDeg === 0);

// cabinet mid-wall (large gaps both ends) -> no filler
ok('no filler mid-wall', computeFillers({ room, items: [{ id: 1, code: 'F2', x: 0, z: Z, rotDeg: 0 }] }).length === 0);

// a tiny hairline gap is ignored
ok('hairline gap ignored', computeFillers({ room, items: [{ id: 1, code: 'F2', x: -71.85, z: Z, rotDeg: 0 }] }).length === 0);

// cost includes a priced filler line
const sum = summarize(s1.items, f1);
const fl = sum.lines.find((l) => l.filler);
ok('cost has filler line', !!fl && fl.qty === 1);
ok('subtotal = cab + filler', Math.abs(sum.subtotal - (sellUSD(getCab('F2')) + FILLER_SELL)) < 0.01);
ok('fillers not counted as cabinets', sum.totalCabs === 1);

console.log(`\nfillers.test.js — ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

// ---- mid-run fillers -----------------------------------------------------------
// A gap BETWEEN two cabinets in a run (e.g. the scribe beside an exactly-seated
// corner unit) gets a painted filler too — never an open hole.
import { test as _t } from 'node:test';
import _assert from 'node:assert/strict';
_t('mid-run gap between neighbours gets a filler; worktop spans it', async () => {
  const { computeFillers } = await import('../src/core/fillers.js');
  const { planWorktopSlabs } = await import('../src/core/worktop-plan.js');
  const { getCab } = await import('../src/core/catalogue.js');
  const room = { width: 200, depth: 140, height: 96 };
  const items = [
    { id: 1, code: 'F2', x: -76 + 12, z: -70 + 12.25, rotDeg: 0 },
    { id: 2, code: 'F2', x: -76 + 24 + 7 + 12, z: -70 + 12.25, rotDeg: 0 },  // 7" mid-run gap
  ];
  const fills = computeFillers({ room, items });
  const mid = fills.find((f) => Math.abs(f.w - 7) < 0.05);
  _assert.ok(mid, `expected a 7" mid-run filler, got ${JSON.stringify(fills)}`);
  // and the worktop bridges the gap as ONE slab
  const slabs = planWorktopSlabs(items, getCab, 'marble', room);
  _assert.equal(slabs.length, 1, 'one continuous slab across the filler');
});
