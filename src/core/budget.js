// budget.js — design TO a budget. Given a built layout and a max spend, plan
// a series of like-for-like swaps (identical widths, so every layout rule and
// position is untouched) that walk the estimate down until it fits — glazing
// first, then drawers→doors, simpler larders, and open shelving as the last
// resort. Pure + testable; the wizard applies the swaps via store.swapItem.

import { getCab, sellUSD } from './catalogue.js';
import { summarizeState } from './cost.js';

// cheapest-look-last ladder; every mapping is SAME WIDTH & type. The island
// stage is structural: it drops the second (back-to-back) row and finishes
// the exposed backs — barely visible, big saving.
const LADDER = [
  { label: 'plain doors instead of glazed', map: { W7: 'W5', W8: 'W6', W4: 'W2', W3: 'W1', C5: 'C3', C6: 'C4', C2: 'C1' } },
  { label: 'door cabinets instead of drawer banks', map: { F17: 'F1', F18: 'F2', F19: 'F3', F20: 'F10' } },
  { label: 'simpler pantries', map: { T6: 'T5', T8: 'T7' } },
  { label: 'single-sided island', island: true },
  { label: 'open shelving', map: { F1: 'F23', F2: 'F24', F3: 'F25', W2: 'W12', W1: 'W11' } },
];

/**
 * @param {object} state   serialized store state (not mutated)
 * @param {number} budget  max spend in sell-USD
 * @returns {{ swaps: Array<{id:number, from:string, to:string}>, total:number,
 *             met:boolean, before:number, stages:string[] }}
 */
export function planBudgetSwaps(state, budget) {
  const working = JSON.parse(JSON.stringify(state));
  const before = summarizeState(working).subtotal;
  const swaps = [];
  const removals = [];
  const patches = [];
  const stages = [];
  let total = before;
  if (!(budget > 0) || total <= budget) return { swaps, removals, patches, total, met: true, before, stages };

  // never downgrade the base that carries the sink (open shelves under a sink!)
  const sinks = working.items.filter((it) => getCab(it.code)?.appliance === 'sink');
  const holdsSink = (it) => sinks.some((s) => Math.abs(s.x - it.x) < 2 && Math.abs(s.z - it.z) < 2);

  for (const stage of LADDER) {
    if (total <= budget) break;
    let used = false;
    if (stage.island) {
      // drop the island's back-to-back row, most expensive unit first, and
      // finish the exposed back of each facing unit (end panel)
      const backRow = working.items
        .filter((it) => it.island && ((((it.rotDeg || 0) % 360) + 360) % 360) === 0 && !holdsSink(it))
        .sort((a, b) => sellUSD(getCab(b.code)) - sellUSD(getCab(a.code)));
      for (const it of backRow) {
        if (total <= budget) break;
        removals.push(it.id);
        working.items = working.items.filter((x) => x.id !== it.id);
        const front = working.items.find((f) => f.island && f.id !== it.id && Math.abs(f.x - it.x) < 2);
        if (front && !front.backPanel) { front.backPanel = true; patches.push({ id: front.id, patch: { backPanel: true } }); }
        used = true;
        total = summarizeState(working).subtotal;
      }
    } else {
      // most expensive first, so the fewest cabinets change
      const cands = working.items
        .filter((it) => stage.map[it.code] && !holdsSink(it))
        .sort((a, b) => sellUSD(getCab(b.code)) - sellUSD(getCab(a.code)));
      for (const it of cands) {
        if (total <= budget) break;
        const to = stage.map[it.code];
        swaps.push({ id: it.id, from: it.code, to });
        it.code = to;
        used = true;
        total = summarizeState(working).subtotal;
      }
    }
    if (used) stages.push(stage.label);
  }
  return { swaps, removals, patches, total, met: total <= budget, before, stages };
}
