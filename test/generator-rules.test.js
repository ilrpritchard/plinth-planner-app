// generator-rules.test.js — hard design rules the layout generator must never
// break, swept across every shape × wall width (4–25ft) × room depth × seeds,
// so no manual spot-testing is needed. These caught real bugs: L-shape runs
// overshooting short walls, the cooker landing at the wall end, the dishwasher
// silently dropped from mid-size L-shapes, the side wall left half-empty, and
// "Generate again" returning an identical layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKitchen } from '../src/core/layouts.js';
import { getCab } from '../src/core/catalogue.js';

const W = (c) => getCab(c)?.w || 24;
const isCook = (c) => /^AP[123]$/.test(c);
const SHAPES = ['straight', 'l-shape', 'island', 'u-shape', 'galley'];
const DEPTHS = [80, 140, 220];
const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const CORNER_RETURN = 24.25;   // leg-to-leg: side-run depth + scribe (drawn return stretches to the wall)

function* sweep(from = 48, to = 300, step = 4) {
  for (const shape of SHAPES) for (const depth of DEPTHS) for (let width = from; width <= to; width += step) for (const seed of SEEDS) {
    const { steps } = generateKitchen(shape, { width, depth }, seed);
    yield { shape, width, depth, seed, steps,
      back: steps.filter((s) => s.wall === 'back'),
      left: steps.filter((s) => s.wall === 'left') };
  }
}

const backUsed = (back) => back.reduce((t, o) => t + W(o.code) + (o.corner ? CORNER_RETURN : 0), 0);

test('back run NEVER overshoots the wall (any shape, size, or seed)', () => {
  for (const { shape, width, depth, seed, back } of sweep()) {
    const used = backUsed(back);
    assert.ok(used <= width + 0.1, `${shape} ${width}x${depth} seed=${seed}: run ${used}" overshoots ${width}" wall`);
  }
});

test('cooker is never at a wall end (walls ≥ 64"; L-shape: any width, both runs)', () => {
  for (const { shape, width, depth, seed, back, left } of sweep()) {
    if (left.length && isCook(left[left.length - 1].code))
      assert.fail(`${shape} ${width}x${depth} seed=${seed}: cooker at the OPEN end of the side run`);
    if (shape !== 'l-shape' && width < 64) continue;  // sub-5ft: sink+cooker alone exceed the wall
    if (!back.length) continue;
    assert.ok(!isCook(back[0].code) && !isCook(back[back.length - 1].code),
      `${shape} ${width}x${depth} seed=${seed}: cooker at the end of the back run`);
  }
});

test('sink never directly beside the cooker (walls ≥ 112")', () => {
  for (const { shape, width, depth, seed, back } of sweep(112)) {
    for (let i = 0; i < back.length - 1; i++) {
      const a = back[i], b = back[i + 1];
      assert.ok(!((a.sink && isCook(b.code)) || (b.sink && isCook(a.code))),
        `${shape} ${width}x${depth} seed=${seed}: sink directly beside the cooker`);
    }
  }
});

test('essentials survive: sink always; cooker ≥ 56"; fridge ≥ 80"; DW (str/isl ≥ 104", L any); bin ≥ 132/136"', () => {
  for (const { shape, width, depth, seed, steps } of sweep()) {
    const codes = steps.map((s) => s.code);
    const has = { sink: steps.some((s) => s.sink), cook: codes.some(isCook),
      fridge: codes.includes('T3'), dw: codes.includes('F7'), bin: codes.some((c) => c === 'F21' || c === 'F22') };
    const tag = `${shape} ${width}x${depth} seed=${seed}`;
    assert.ok(has.sink, `${tag}: no sink`);
    if (width >= 56) assert.ok(has.cook, `${tag}: no cooker`);
    if (width >= 80) assert.ok(has.fridge, `${tag}: no fridge`);
    // L/U: the DW is guaranteed once EITHER wall can hold it (a short back
    // wall exiles the cooker to the side leg, which then also needs 104" for
    // corner-clearance + fridge + cooker + DW).
    const lish = shape === 'l-shape' || shape === 'u-shape';
    const dwGuaranteed = lish ? (width >= 118 || depth >= 104) : width >= 104;
    if (dwGuaranteed) assert.ok(has.dw, `${tag}: no dishwasher`);
    // corners eat back wall (leg-to-leg: 48.25" each incl. the drawn return),
    // so the bin needs more room on cornered shapes
    const binFrom = shape === 'u-shape' ? 196 : shape === 'l-shape' ? 136 : 132;
    if (width >= binFrom) assert.ok(has.bin, `${tag}: no bin`);
  }
});

test('range clearance: >= 18" of base between a cooker and any tall/counter/fridge (rooms >= 112x112)', () => {
  // the hard rule holds wherever the room affords it (both dims >= 112");
  // tighter rooms get the generator's best effort + a live warning instead
  for (const { shape, width, depth, seed, steps } of sweep(112)) {
    if (depth < 112) continue;
    for (const wall of ['back', 'left', 'right', 'front']) {
      const seq = steps.filter((s) => s.wall === wall);
      const ci = seq.findIndex((s) => isCook(s.code) || s.hob);
      if (ci < 0) continue;
      for (const dir of [-1, 1]) {
        let gap = 0;
        for (let j = ci + dir; j >= 0 && j < seq.length; j += dir) {
          const c = getCab(seq[j].code);
          if (c && (c.type === 'TALL' || c.type === 'COUNTER' || c.appliance === 'fridge')) {
            assert.ok(gap >= 18, `${shape} ${width}x${depth} seed=${seed} ${wall}: only ${gap}" between the cooker and ${seq[j].code}`);
            break;
          }
          gap += c?.w || 24;
        }
      }
    }
  }
});

test('dishwasher sits between two leg-bearing cabinets (rooms >= 124" wide)', () => {
  // the F7 panel is legless — it borrows the 22mm legs of the cabinets either
  // side. Guaranteed wherever the wall affords it; tighter walls get the
  // generator's best effort + a live warning.
  const legCab = (s) => { if (!s || s.code === 'F7') return false; const c = getCab(s.code); return !!c && (c.type === 'FLOOR' || c.type === 'TALL'); };
  for (const { shape, width, depth, seed, steps } of sweep(124)) {
    if (depth < 112) continue;
    for (const wall of ['back', 'left', 'right', 'front']) {
      const seq = steps.filter((s) => s.wall === wall);
      seq.forEach((s, i) => {
        if (s.code !== 'F7') return;
        assert.ok(legCab(seq[i - 1]) && legCab(seq[i + 1]),
          `${shape} ${width}x${depth} seed=${seed} ${wall}: F7 at index ${i} lacks a leg-bearing neighbour (${seq[i - 1]?.code || 'run end'} | ${seq[i + 1]?.code || 'run end'})`);
      });
    }
  }
});

test('back run fills wall-to-wall: residual gap ≤ 10" scribe filler (walls ≥ 120")', () => {
  // cap = the sweep's worst packing floor (9.75" since leg-to-leg corners
  // reserve 24.25"); anything wider than a tray space gets packed instead
  for (const { shape, width, depth, seed, back } of sweep(120)) {
    const gap = width - backUsed(back);
    assert.ok(gap <= 10, `${shape} ${width}x${depth} seed=${seed}: ${gap.toFixed(1)}" dead gap to the wall`);
  }
});

test('L-shape side run uses the WHOLE side wall (≤ 10" leftover, any depth)', () => {
  for (let depth = 52; depth <= 260; depth += 8) for (let width = 48; width <= 300; width += 16) for (const seed of SEEDS) {
    const { steps } = generateKitchen('l-shape', { width, depth }, seed);
    const used = steps.filter((s) => s.wall === 'left').reduce((t, o) => t + W(o.code), 0);
    const budget = depth - 26;   // wizard places from 25" (clear of the corner) to 1" short of the front wall
    assert.ok(budget - used <= 10, `w=${width} d=${depth} seed=${seed}: side leg leaves ${(budget - used).toFixed(1)}" unused`);
  }
});

test('short L-shape degrades gracefully: exiled cooker/DW land mid-side-run, talls close the open end', () => {
  for (let width = 48; width < 118; width += 4) for (const seed of SEEDS) {
    const { steps } = generateKitchen('l-shape', { width, depth: 140 }, seed);
    const left = steps.filter((s) => s.wall === 'left').map((s) => s.code);
    assert.ok(steps.map((s) => s.code).some(isCook), `w=${width} seed=${seed}: cooker lost entirely`);
    assert.ok(left.includes('T3'), `w=${width} seed=${seed}: no fridge on the side run`);
    const lastTall = left[left.length - 1];
    assert.ok(getCab(lastTall)?.type === 'TALL', `w=${width} seed=${seed}: side run ends with ${lastTall}, not a tall`);
  }
});

test('U-shape right leg + galley facing run fill their walls (≤ 10" leftover)', () => {
  for (const seed of SEEDS) {
    for (let depth = 100; depth <= 220; depth += 24) for (let width = 200; width <= 300; width += 20) {
      const u = generateKitchen('u-shape', { width, depth }, seed);
      const rightUsed = u.steps.filter((s) => s.wall === 'right').reduce((t, o) => t + W(o.code), 0);
      assert.ok((depth - 26) - rightUsed <= 10, `u-shape ${width}x${depth} seed=${seed}: right leg leaves ${(depth - 26 - rightUsed).toFixed(1)}"`);
      assert.ok(u.steps.some((s) => s.corner && s.code === 'F16R'), `u-shape ${width}x${depth}: no right corner unit`);
    }
    for (let width = 100; width <= 300; width += 20) {
      const g = generateKitchen('galley', { width, depth: 140 }, seed);
      const front = g.steps.filter((s) => s.wall === 'front');
      const used = front.reduce((t, o) => t + W(o.code), 0);
      assert.ok((width - 2) - used <= 10, `galley w=${width} seed=${seed}: facing run leaves ${(width - 2 - used).toFixed(1)}"`);
      assert.ok(front.some((s) => s.code === 'T3'), `galley w=${width}: no fridge on the facing run`);
    }
  }
});

test('U-shape keeps ALL THREE walls on narrow rooms (cooker exiled to a leg)', () => {
  for (const seed of SEEDS) {
    const { steps } = generateKitchen('u-shape', { width: 132, depth: 180 }, seed);
    assert.ok(steps.some((s) => s.wall === 'left'), 'no left leg');
    assert.ok(steps.some((s) => s.wall === 'right'), 'no right leg');
    assert.ok(steps.some((s) => s.corner && s.code === 'F16R'), 'lost the second corner');
    assert.ok(steps.map((s) => s.code).some(isCook), 'lost the cooker');
  }
});

test('galley degrades to a straight run when the corridor is too tight (< 92" deep)', () => {
  for (const seed of SEEDS) {
    const { steps } = generateKitchen('galley', { width: 160, depth: 84 }, seed);
    assert.equal(steps.filter((s) => s.wall === 'front').length, 0);
    assert.ok(steps.some((s) => s.code === 'T3'), 'fridge returns to the back run');
  }
});

test('runs stop clear of a doorway (door-aware routing)', () => {
  for (const seed of SEEDS) {
    // door mid-way down the LEFT wall: span [25,78] vs [122,199] → run ≤ 77
    const room = { width: 240, depth: 200, openings: [{ id: 1, type: 'doorway', wall: 'left', pos: 0.5, width: 36 }] };
    const { steps } = generateKitchen('l-shape', room, seed);
    const used = steps.filter((s) => s.wall === 'left').reduce((t, o) => t + W(o.code), 0);
    assert.ok(used <= 77.5, `seed=${seed}: side run ${used}" would cross the door`);
    assert.ok(77 - used <= 10, `seed=${seed}: side run leaves ${(77 - used).toFixed(1)}" of the free span unused`);
    // galley: door on the FRONT wall → the facing run fits the larger stretch
    const g = generateKitchen('galley', { width: 200, depth: 140, openings: [{ id: 1, type: 'doorway', wall: 'front', pos: 0.25, width: 36 }] }, seed);
    const fUsed = g.steps.filter((s) => s.wall === 'front').reduce((t, o) => t + W(o.code), 0);
    // door edges [28,72] → larger stretch [72,199] = 127
    assert.ok(fUsed <= 127.5, `seed=${seed}: facing run ${fUsed}" would cross the front door`);
  }
});

test('"Generate again" changes the layout (adjacent seeds differ)', () => {
  for (const shape of SHAPES) {
    for (const [width, depth] of [[96, 120], [120, 100], [144, 120], [192, 140], [240, 160], [288, 200]]) {
      const sigs = new Set();
      for (let seed = 1; seed <= 10; seed++)
        sigs.add(JSON.stringify(generateKitchen(shape, { width, depth }, seed).steps));
      const want = width >= 144 ? 3 : 2;
      assert.ok(sigs.size >= want,
        `${shape} ${width}x${depth}: only ${sigs.size} distinct layout(s) across 10 seeds (want ≥ ${want})`);
    }
  }
});
