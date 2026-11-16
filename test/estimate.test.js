// The unit-mix estimate (W2W-260): the range is read from the live catalogue, the
// volume tiers are the catalogue's own, and the opening mix is the site's sample.
import {
  ESTIMATE_TYPES, referenceKitchens, estimateRates, estimateLeadWeeks, buildEstimate,
  fmtRange, tierText, estimateLeadSource, estimateText,
} from '../src/core/estimate.js';
import { getCab, sellUSD, VOLUME_TIERS } from '../src/core/catalogue.js';
import { DEMO_MIX } from '../src/core/tradedemo.js';
import { tradeSummary } from '../src/core/cost.js';
import { estimateSheetHTML, buildEstimateHTML, ESTIMATE_NOTE } from '../src/ui/estimate.js';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };

// reference kitchens
const refs = referenceKitchens();
ok('six reference kitchens', refs.length === 6);
ok('every reference code is a real, supplied catalogue cabinet', refs.every((k) => k.every(([c]) => { const cab = getCab(c); return cab && !cab.notSupplied && sellUSD(cab) > 0; })));
ok('the plain kitchens are 8, 10 and 12 cabinets', refs.slice(0, 3).map((k) => k.reduce((n, [, q]) => n + q, 0)).join() === '8,10,12');

// rates follow the catalogue
const rate = estimateRates();
const perCab = (k) => k.reduce((s, [c, q]) => s + sellUSD(getCab(c)) * q, 0) / k.reduce((n, [, q]) => n + q, 0);
const all = refs.map(perCab);
ok('low is the cheapest reference kitchen per cabinet', Math.abs(rate.low - Math.min(...all)) < 1e-6);
ok('high is the dearest reference kitchen per cabinet', Math.abs(rate.high - Math.max(...all)) < 1e-6);
ok('low < high, both positive', rate.low > 0 && rate.high > rate.low);

// the opening mix is the site's 62-kitchen sample
const est = buildEstimate(ESTIMATE_TYPES);
ok('opens on 62 kitchens, 588 cabinets', est.units === 62 && est.cabs === 588);
ok('types with no kitchens are left out', est.lines.map((l) => l.id).join() === 'bed1,bed2,bed3');
ok('50 to 99 units earns the 8% tier', est.tier && est.tier.pct === 8);
ok('project range is the cabinets at each rate less the tier, to the nearest $1,000',
  est.low === Math.round(588 * rate.low * 0.92 / 1000) * 1000 && est.high === Math.round(588 * rate.high * 0.92 / 1000) * 1000);
ok('per kitchen is list, to the nearest $100', est.lines[0].low === Math.round(8 * rate.low / 100) * 100 && est.lines[0].low % 100 === 0);
ok('7 to 8 weeks in production for 588 cabinets', est.weeks.lo === 7 && est.weeks.hi === 8);

// the site line: a kitchen of 8 to 14 cabinets is $20,000 to $40,000 (to the nearest thousand)
const k8 = buildEstimate([{ id: 'a', beds: '1 Bed', units: 1, cabs: 8 }]).lines[0];
const k14 = buildEstimate([{ id: 'a', beds: '1 Bed', units: 1, cabs: 14 }]).lines[0];
ok(`8 cabinets starts near $20,000 (${k8.low})`, k8.low >= 19000 && k8.low <= 22000);
ok(`14 cabinets tops out near $40,000 (${k14.high})`, k14.high >= 37000 && k14.high <= 42000);

// The Morgan priced in full sits inside the estimate of its own mix
const morgan = tradeSummary({ units: DEMO_MIX.map((m, i) => ({ id: i + 1, beds: m.beds, qty: (m.floorTo - m.floorFrom + 1) * m.perFloor, rows: m.cabs.map(([code, qty]) => ({ code, qty })) })) });
const asMix = morgan.lines.map((l, i) => ({ id: 't' + i, beds: l.name, units: l.qty, cabs: l.cabsPerUnit }));
const mEst = buildEstimate(asMix);
ok('The Morgan: same units and cabinets', mEst.units === morgan.totalUnits && mEst.cabs === morgan.totalCabs);
ok(`The Morgan's real total (${Math.round(morgan.grand)}) is inside its estimate (${mEst.low} to ${mEst.high})`, morgan.grand >= mEst.low - 500 && morgan.grand <= mEst.high + 500);

// tiers are the catalogue's
for (const t of VOLUME_TIERS) {
  const e = buildEstimate([{ id: 'a', beds: '1 Bed', units: t.min, cabs: 10 }]);
  ok(`${t.min} units earns ${t.pct}%`, e.tier && e.tier.pct === t.pct);
}
ok('under 10 units: no tier', buildEstimate([{ id: 'a', beds: '1 Bed', units: 9, cabs: 10 }]).tier === null);
ok('tier text', tierText(est.tier) === '8%, from 50 units' && tierText(null) === 'From 10 units');

// lead time as published
ok('100 cabinets or fewer: 5 to 6 weeks', estimateLeadWeeks(60).lo === 5 && estimateLeadWeeks(100).hi === 6);
ok('2,000 cabinets or more: 12 to 14 weeks', estimateLeadWeeks(2000).lo === 12 && estimateLeadWeeks(5000).hi === 14);

// bad input never produces nonsense
const junk = buildEstimate([{ id: 'a', beds: '1 Bed', units: '-4', cabs: 'x' }, { id: 'b', beds: '2 Bed', units: '12.9', cabs: '0' }, { id: 'c', beds: '3 Bed', units: 99999, cabs: 500 }]);
ok('negative and empty are no kitchens', !junk.lines.some((l) => l.id === 'a'));
ok('a decimal is floored, cabinets are at least 1', junk.lines[0].units === 12 && junk.lines[0].cabs === 1);
ok('numbers are capped', junk.lines[1].units === 999 && junk.lines[1].cabs === 30);
const none = buildEstimate([]);
ok('an empty mix is $0 with no lead time', none.units === 0 && none.low === 0 && none.weeks === null);

// what leaves the page
ok('range text', fmtRange(1325000, 1542000) === '$1,325,000 to $1,542,000');
ok('lead tag carries the mix', /^estimate:62u\/588c\/1 Bed 24x8, 2 Bed 30x10, 3 Bed 8x12$/.test(estimateLeadSource(est)));
const text = estimateText(est);
ok('email text has every type and the project line', /1 Bed: 24 kitchens of 8 cabinets/.test(text) && /The project: \$/.test(text));

const sheet = estimateSheetHTML(est), doc = buildEstimateHTML(est, { name: 'A. Developer', date: new Date(2026, 10, 16) });
ok('sheet shows the range and 62 kitchens', sheet.includes(fmtRange(est.low, est.high)) && sheet.includes('62 kitchens'));
ok('empty sheet asks for a number, shows $0', /at least 1 type/.test(estimateSheetHTML(none)) && estimateSheetHTML(none).includes('$0'));
ok('document names who it is for and the date', doc.includes('Prepared for A. Developer') && doc.includes('November 16, 2026'));
ok('a name is escaped', buildEstimateHTML(est, { name: '<b>x</b>' }).includes('&lt;b&gt;x'));
// her copy rules: an estimate, confirmed on quote; no em dashes; no "your"; no fixed price
for (const [label, s] of [['sheet', sheet], ['document', doc], ['note', ESTIMATE_NOTE]]) {
  ok(`${label}: no em dash`, !s.includes('—'));
  ok(`${label}: never "your" or "fixed"`, !/\byour\b|fixed/i.test(s.replace(/<style>[\s\S]*?<\/style>/, '')));
}
ok('the note says estimate and confirmed on quote', /estimate/i.test(ESTIMATE_NOTE) && /confirmed on quote/.test(ESTIMATE_NOTE));

console.log(`estimate: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
