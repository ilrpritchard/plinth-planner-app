// tradedemo.js — the "example building" the trade tab opens on for a first
// visit: The Morgan, a 47-unit building with three kitchen types, each one laid
// out in 3D (tradedemo-building.js) and priced from the live catalogue, so the
// first numbers a developer sees are the numbers they would get. Pure data +
// a builder; no DOM.

import { DEMO_DESIGNS } from './tradedemo-building.js';

export const DEMO_PROJECT = 'The Morgan';
export const DEMO_ADDRESS = 'New York, NY';

// One entry per kitchen type: the floors it repeats across (unitQty = floors ×
// per floor), and the cabinets in each kitchen as [code, qty] pairs: the same
// rows the 3D layout produced. Every code must exist in the catalogue
// (tradedemo.test.js checks).
export const DEMO_MIX = [
  { beds: '1 Bed', letter: 'A', floorFrom: 2, floorTo: 12, perFloor: 2,     // 22 units
    cabs: [['F2', 1], ['F7', 1], ['F17', 2], ['F21', 1], ['S11', 1], ['W18', 2], ['W22:w14', 2], ['T4', 1]] },
  { beds: '2 Bed', letter: 'B', floorFrom: 2, floorTo: 6, perFloor: 3,      // 15 units
    cabs: [['F2', 1], ['F7', 1], ['F19', 2], ['F21', 1], ['S11', 1], ['W18', 2], ['W22:w23', 2], ['T4', 1]] },
  { beds: '3 Bed', letter: 'C', floorFrom: 7, floorTo: 11, perFloor: 2,     // 10 units
    cabs: [['F7', 1], ['F10', 1], ['F15R', 1], ['F19', 2], ['F22', 1], ['S11', 2], ['W15', 2], ['W19', 2], ['W22:w29.5', 1], ['W23:w30', 1], ['T4', 2]] },
];

const mixQty = (m) => (m.floorTo - m.floorFrom + 1) * m.perFloor;

/** Build the demo unit types with ids continuing from the given counters.
 *  Each unit carries a deep copy of its stored 3D design. Returns
 *  { units, nextUnitId, nextRowId } for the caller to splice into trade state. */
export function buildDemoUnits(nextUnitId = 1, nextRowId = 1) {
  const units = DEMO_MIX.map((m) => ({
    id: nextUnitId++,
    beds: m.beds, letter: m.letter, name: '',
    qty: mixQty(m), floorFrom: m.floorFrom, floorTo: m.floorTo, perFloor: m.perFloor,
    rows: m.cabs.map(([code, qty]) => ({ id: nextRowId++, code, qty })),
    design: DEMO_DESIGNS[m.beds] ? JSON.parse(JSON.stringify(DEMO_DESIGNS[m.beds])) : undefined,
  }));
  return { units, nextUnitId, nextRowId };
}

/** Total units in the demo mix (what the welcome card promises). */
export function demoUnitCount() {
  return DEMO_MIX.reduce((n, m) => n + mixQty(m), 0);
}
