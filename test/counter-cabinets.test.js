// counter-cabinets.test.js — a COUNTER cabinet stands ON the worktop over a base: it takes no
// floor run and never "overlaps" the base beneath it (her question 2026-09-22: "why aren't the
// double counter cabinets showing up... they would fit on that wall").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWarnings } from '../src/core/warnings.js';
import { getCab } from '../src/core/catalogue.js';
import { counterShelfTops, SPEC } from '../src/core/units.js';
import { frontParts } from '../src/ui/frontdraw.js';

const W = 150, D = 120, f = getCab('F19'), c3 = getCab('C3'), t = getCab('T10');
const room = { width: W, depth: D, height: 96, openings: [] };
const onBack = (id, code, x, extra = {}) => { const c = getCab(code); return { id, code, x, z: -D / 2 + c.d / 2 + 0.25 + (c.type === 'TALL' ? 1.18 : 0), rotDeg: 0, ...extra }; };
const msgs = (items) => computeWarnings({ room, items }).filter((w) => w.level === 'error').map((w) => w.msg);

test('a counter double over a drawer base is not an overlap; a counter double through a tall is', () => {
  const base = onBack(1, 'F19', -40), over = onBack(2, 'C3', -40);
  assert.deepEqual(msgs([base, over]).filter((m) => /overlap/.test(m)), []);
  const tall = onBack(3, 'T10', -40 + 10);
  assert.ok(msgs([base, over, tall]).some((m) => /C3 and T10 overlap|T10 and C3 overlap/.test(m)));
  // two bases still may not overlap
  assert.ok(msgs([base, onBack(4, 'F19', -30)]).some((m) => /F19 and F19 overlap/.test(m)));
});

test('two shelves in a counter cabinet: the first 400mm up from the counter, the second equally spaced above', () => {
  const tops = counterShelfTops(50 - SPEC.PANEL_IN);          // 50" cabinet, under its 22mm top
  assert.equal(tops.length, 2);
  assert.ok(Math.abs(tops[0] - 400 / 25.4) < 1e-9);
  const gap = tops[1] - (tops[0] + SPEC.SHELF_IN);
  assert.ok(Math.abs((50 - SPEC.PANEL_IN - (tops[1] + SPEC.SHELF_IN)) - gap) < 1e-9, 'the same clear space above the second shelf as between them');
  // the drawings carry them: glazed and open counter fronts, two shelves each
  for (const code of ['C2', 'C5', 'C8']) {
    const sh = [...new Set(frontParts(getCab(code)).parts.filter((p) => p.k === 'shelf').map((p) => +p.y.toFixed(6)))].map((y) => ({ y }));   // a double shows them through both leaves
    assert.equal(sh.length, 2, code);
    assert.ok(sh.some((p) => Math.abs((50 - p.y) - tops[0]) < 1e-3), `${code}: a shelf top 400mm up`);
  }
  assert.equal(frontParts(getCab('C1')).parts.filter((p) => p.k === 'shelf').length, 0, 'a solid door hides them');
});
