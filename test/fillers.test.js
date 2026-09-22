// Auto-filler: gap detection + cost inclusion.
import { planWorktopSlabs } from '../src/core/worktop-plan.js';
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

// her screenshot 2026-09-22: a tall in the corner on the side wall, the back-wall base stopping
// 3" short of its flank: that gap gets a scribe to the FLANK, not to the wall 27" away
{
  const W = 150, D = 120, t = getCab('T1'), f = getCab('F10');
  const tall = { id: 1, code: 'T1', x: -W / 2 + t.d / 2 + 0.25 + 1.18, z: -D / 2 + t.w / 2 + 0.25, rotDeg: 90 };   // on the left wall, in the back corner
  const flank = tall.x + t.d / 2;                                                                                  // its right-hand face
  const base = { id: 2, code: 'F10', x: flank + 3 + f.w / 2, z: -D / 2 + f.d / 2 + 0.25, rotDeg: 0 };              // back wall, 3" off the flank
  const fills = computeFillers({ room: { width: W, depth: D, height: 96, openings: [], boxings: [] }, items: [tall, base] });
  const corner = fills.find((x) => x.band === 'floor' && x.rotDeg === 0 && Math.abs(x.w - 3) < 0.01);
  ok('scribe to the tall flank in the corner', !!corner && Math.abs(corner.x - (flank + 1.5)) < 0.01 && corner.h === 35);
  ok('no 27" filler to the wall behind the tall', !fills.some((x) => x.w > 9));
}

// ...and the other way round: the run ends in a TALL on the back wall, an F32 base owns the corner on
// the side wall: the scribe to the base's flank stops under the counter (35"), not the tall's 86"
{
  const W = 150, D = 120, t = getCab('T1'), f = getCab('F32');
  const base = { id: 1, code: 'F32', x: -W / 2 + f.d / 2 + 0.25, z: -D / 2 + f.w / 2 + 0.25, rotDeg: 90 };      // left wall, back corner
  const flank = base.x + f.d / 2;
  const tall = { id: 2, code: 'T1', x: flank + 3 + t.w / 2, z: -D / 2 + t.d / 2 + 0.25 + 1.18, rotDeg: 0 };   // back wall, 3" off the base's flank
  const fills = computeFillers({ room: { width: W, depth: D, height: 96, openings: [], boxings: [] }, items: [base, tall] });
  const corner = fills.find((x) => x.band === 'floor' && x.rotDeg === 0 && Math.abs(x.w - 3) < 0.01);
  ok('scribe from a tall to a base flank stops under the counter', !!corner && corner.h === 35);
}

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


// worktop round the dead corner (her call 2026-09-22): an F32 on the right wall reaching the back
// corner, nothing standing in the corner on the back wall, a tall 30" along it: the top continues
// along the back wall from the corner to the tall's flank
{
  const W = 150, D = 120, f = getCab('F32'), t = getCab('T1');
  const items = [{ id: 1, code: 'F32', x: W / 2 - f.d / 2 - 0.25, z: -D / 2 + f.w / 2 + 0.25, rotDeg: 270 }, { id: 2, code: 'T1', x: W / 2 - 30 - t.w / 2, z: -D / 2 + t.d / 2 + 0.25 + 1.18, rotDeg: 0 }];
  const slabs = planWorktopSlabs(items, getCab, 'marble', { width: W, depth: D, height: 96, openings: [], boxings: [] });
  const over = (px, pz) => slabs.some((s) => px > s.x0 - 0.01 && px < s.x1 + 0.01 && pz > s.z0 - 0.01 && pz < s.z1 + 0.01);
  ok('worktop covers the dead corner', over(W / 2 - 12, -D / 2 + 12));
  ok('...and runs along the back wall to the tall\'s flank', over(W / 2 - 28, -D / 2 + 12) && !over(W / 2 - 31, -D / 2 + 12));
}
// her W25 open shelf beside a W9 corner unit (2026-09-22): the mid-run scribe measures to the corner's RETURN
{
  const st = { room: { width: 118.9, depth: 86.2, height: 95.3 }, items: [
    { id: 1, code: 'W9', x: -19.47, z: -35.85, rotDeg: 0 },          // body -29.47..-9.47, return to -39.47
    { id: 2, code: 'W25', x: -51.7, z: -35.85, rotDeg: 0 },          // 15" shelf on the left of the back wall, right edge -44.2
  ] };
  const up = computeFillers(st).filter((f) => f.band === 'upper');
  const mid = up.find((f) => Math.abs(f.x - (-41.835)) < 0.1);
  ok(mid && Math.abs(mid.w - 4.73) < 0.05, `scribe between the shelf and the corner return: ${up.map((f) => f.w.toFixed(2) + '@' + f.x.toFixed(2)).join(' ')}`);
}

console.log(`\nfillers.test.js — ${pass} passed, ${fail} failed`);
