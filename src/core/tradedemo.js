// tradedemo.js — the "example building" the trade tab opens on for a first
// visit. A 62-unit mid-rise with three kitchen types, priced from the live
// catalogue, so the first numbers a developer sees are the numbers they would
// get. Pure data + a builder; no DOM.

export const DEMO_PROJECT = 'Example building';

// One entry per kitchen type: how many units it repeats across, and the
// cabinets in each kitchen as [code, qty] pairs. Every code must exist in the
// catalogue (tradedemo.test.js checks).
export const DEMO_MIX = [
  { beds: '1 Bed', letter: 'A', qty: 24, cabs: [['F21', 1], ['F10', 1], ['F7', 1], ['F17', 1], ['F16', 1], ['W2', 1], ['W5', 1], ['W1', 1]] },
  { beds: '2 Bed', letter: 'B', qty: 30, cabs: [['F21', 1], ['F10', 1], ['F7', 1], ['F17', 1], ['F16', 1], ['F18', 1], ['W2', 1], ['W5', 2], ['W1', 1]] },
  { beds: '3 Bed', letter: 'C', qty: 8, cabs: [['F21', 1], ['F10', 1], ['F7', 1], ['F17', 1], ['F16', 1], ['F18', 1], ['F19', 1], ['F20', 1], ['W2', 1], ['W5', 1], ['W6', 1], ['W1', 1]] },
];

/** Build the demo unit types with ids continuing from the given counters.
 *  Returns { units, nextUnitId, nextRowId } for the caller to splice into
 *  trade state. */
export function buildDemoUnits(nextUnitId = 1, nextRowId = 1) {
  const units = DEMO_MIX.map((m) => ({
    id: nextUnitId++,
    beds: m.beds, letter: m.letter, name: '',
    qty: m.qty, floorFrom: '', floorTo: '', perFloor: '',
    rows: m.cabs.map(([code, qty]) => ({ id: nextRowId++, code, qty })),
  }));
  return { units, nextUnitId, nextRowId };
}

/** Total units in the demo mix (what the welcome card promises). */
export function demoUnitCount() {
  return DEMO_MIX.reduce((n, m) => n + m.qty, 0);
}
