// rationale.js — the "why" behind a generated layout. Pure geometric analysis
// of the placed items → a short list of design-rationale notes, each with the
// item ids it refers to (the UI highlights them on click). This is what turns
// the generator from a black box into a designer who explains their thinking.

import { getCab } from './catalogue.js';

const isType = (it, t) => getCab(it.code)?.type === t;
const appliance = (it) => getCab(it.code)?.appliance;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Two items butted side-by-side on the same run (within 3"). */
function adjacent(a, b) {
  const ca = getCab(a.code), cb = getCab(b.code);
  if (!ca || !cb) return false;
  if (((a.rotDeg || 0) % 180) !== ((b.rotDeg || 0) % 180)) return false;
  const horiz = ((a.rotDeg || 0) % 180) === 0;
  const gapAlong = Math.abs((horiz ? a.x : a.z) - (horiz ? b.x : b.z)) - (ca.w + cb.w) / 2;
  const offAcross = Math.abs(horiz ? a.z - b.z : a.x - b.x);
  return gapAlong < 3 && offAcross < 12;
}

/** @returns {Array<{text:string, ids:number[]}>} max ~6, priority order */
export function designRationale(state) {
  const items = state.items || [];
  const notes = [];
  const find = (pred) => items.filter(pred);

  const sink = find((it) => appliance(it) === 'sink')[0];
  const range = find((it) => appliance(it) === 'range')[0] || find((it) => appliance(it) === 'hob')[0];
  const oven = find((it) => it.code === 'T9')[0];
  const fridge = find((it) => it.code === 'T3' || it.code === 'T4' || appliance(it) === 'fridge')[0];
  const dw = find((it) => it.code === 'F7')[0];
  const bin = find((it) => it.code === 'F21' || it.code === 'F22')[0];
  const hood = find((it) => appliance(it) === 'hood')[0];

  // work triangle first — the headline
  if (sink && range && fridge) {
    const loop = (dist(sink, range) + dist(range, fridge) + dist(fridge, sink)) / 12;
    if (loop <= 26) notes.push({ short: `Work triangle ${loop.toFixed(0)} ft`, text: `Work triangle: ${loop.toFixed(0)} ft loop between sink, range and refrigerator`, ids: [sink.id, range.id, fridge.id] });
  }
  if (dw && sink && adjacent(dw, sink)) notes.push({ short: 'Dishwasher by the sink', text: 'Dishwasher right beside the sink — rinse and load in one motion', ids: [dw.id, sink.id] });
  if (bin && sink && dist(bin, sink) < 60) notes.push({ short: 'Trash pull-out by the sink', text: 'Trash pull-out an arm’s reach from the sink', ids: [bin.id] });
  if (range) {
    const flank = find((it) => it.id !== range.id && isType(it, 'FLOOR') && adjacent(it, range));
    if (flank.length >= 2) notes.push({ short: 'Landings flank the range', text: 'Landing space on BOTH sides of the range — pans always have somewhere to go', ids: [range.id, ...flank.map((f) => f.id)] });
    else if (flank.length === 1) notes.push({ short: 'Range guarded by a landing', text: 'A landing cabinet guards the range — it never sits at the bare wall end', ids: [range.id, flank[0].id] });
  }
  if (hood && range) notes.push({ short: 'Hood over the range', text: 'Range hood centered over the cooking zone', ids: [hood.id] });
  if (oven) notes.push({ short: 'Oven at eye level', text: 'Wall oven housed at eye level beside the refrigerator — no bending to check the roast', ids: [oven.id] });
  if (sink) {
    const win = (state.room.openings || []).find((o) => o.type === 'window');
    if (win) notes.push({ short: 'Sink under the window', text: 'Sink under the window — daylight where you scrub', ids: [sink.id] });
  }
  const seat = find((it) => it.seating);
  if (seat.length) notes.push({ short: 'Breakfast-bar overhang', text: 'Breakfast-bar overhang on the island, with the walkway kept clear for stools', ids: seat.map((s) => s.id) });
  else if (find((it) => it.island).length) notes.push({ short: '44" island walkways', text: 'Island sized to keep 44" walkways on every side', ids: find((it) => it.island).map((s) => s.id) });
  const door = (state.room.openings || []).find((o) => o.type === 'doorway' || o.type === 'door');
  if (door) notes.push({ short: 'Runs clear of the door', text: 'Cabinet runs held clear of the doorway and its swing', ids: [] });
  if (fridge && (isType(fridge, 'TALL') || appliance(fridge) === 'fridge')) {
    notes.push({ short: 'Fridge at the run end', text: 'Refrigerator at the end of the run — grab a drink without crossing the cook zone', ids: [fridge.id] });
  }

  return notes.slice(0, 6);
}
