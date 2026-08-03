// Trade (multi-unit) pricing + quantity + order tests.
import { tradeSummary, unitQty, unitName } from '../src/core/cost.js';
import { buildTradeOrderEmail } from '../src/core/order.js';
import { getCab, sellUSD, TRADE, volumeTier } from '../src/core/catalogue.js';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };

ok('floors×perfloor qty (5–20 ×2 = 32)', unitQty({ floorFrom: 5, floorTo: 20, perFloor: 2 }) === 32);
ok('count fallback', unitQty({ qty: 7 }) === 7);
ok('unitName default', unitName({ beds: '2 Bed', letter: 'B' }) === '2 Bed Type B');

const trade = {
  project: 'Tower', finish: 'Ghost', units: [
    { id: 1, beds: '1 Bed', letter: 'A', qty: 10, rows: [{ id: 1, code: 'F2', qty: 5 }, { id: 2, code: 'W2', qty: 3 }] },
    { id: 2, beds: '2 Bed', letter: 'B', floorFrom: 1, floorTo: 5, perFloor: 4, rows: [{ id: 3, code: 'F10', qty: 2 }] },
  ],
};
const s = tradeSummary(trade);
ok('unit A cabs/unit = 8', s.lines[0].cabsPerUnit === 8);
ok('unit B units = 20', s.lines[1].qty === 20);
ok('total units = 30', s.totalUnits === 30);
ok('total cabinets = 120', s.totalCabs === 8 * 10 + 2 * 20);
const expSub = (sellUSD(getCab('F2')) * 5 + sellUSD(getCab('W2')) * 3) * 10 + sellUSD(getCab('F10')) * 2 * 20;
ok('subtotal', Math.abs(s.subtotal - expSub) < 0.01);
ok('containers', s.containers === Math.ceil(s.totalCabs / TRADE.capPerContainer));
// 30 units lands in the 25–49 volume tier — grand nets the indicative discount
ok('volume tier picked (25–49)', s.tier && s.tier.min === 25 && s.tier === volumeTier(30));
ok('discount = subtotal × tier pct', Math.abs(s.discount - s.subtotal * s.tier.pct / 100) < 0.01);
ok('grand = subtotal − discount + shipping', Math.abs(s.grand - (s.subtotal - s.discount + s.shipping)) < 0.01);
// under 10 units → no tier, no discount
const sTiny = tradeSummary({ units: [{ id: 1, qty: 5, rows: [{ id: 1, code: 'F2', qty: 4 }] }] });
ok('no tier under 10 units', !sTiny.tier && sTiny.discount === 0 &&
  Math.abs(sTiny.grand - (sTiny.subtotal + sTiny.shipping)) < 0.01);

const mail = buildTradeOrderEmail({ trade, customer: { name: 'I', email: 'i@x.com', notes: '' } });
ok('trade mailto target', mail.href.startsWith('mailto:imogen@plinthmade.com'));
ok('subject mentions units', mail.subject.includes('units'));

console.log(`\ntrade.test.js — ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
