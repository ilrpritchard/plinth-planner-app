// The share link carries ONLY the design, as compact URL-safe text (#k=), and the
// original whole-state #d= links still open. core/persistence.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';

globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));
globalThis.location = { origin: 'https://planner.plinthmade.com', pathname: '/', hash: '', search: '' };
globalThis.history = { replaceState() {} };
const { buildShareURL, loadFromHash, encodeDesign, decodeDesign } = await import('../src/core/persistence.js');

function kitchen() {
  const st = new Store();
  st.setRoom({ width: 200, depth: 150, height: 96, floor: 'herringbone', wall: 'white', worktop: 'calacatta', cornice: 'plain' });
  st.addOpening({ type: 'window', wall: 'back', pos: 0.30125, width: 48 });
  st.addOpening({ type: 'door', wall: 'left', pos: 0.7 });
  st.addBoxing({ wall: 'right', pos: 0.4, w: 10, d: 8 });
  st.setFinish('Custom RAL');
  st.setCustomer({ name: 'Jane Private', email: 'jane@example.com', notes: 'gate code 4417' });
  const z = -75 + 12.25;
  st.addItem('F16', { x: -63.75, z }); st.addItem('F2', { x: -39.75, z }); st.addItem('AP6', { x: -39.75, z });
  st.addItem('AP1', { x: 7.25, z: -61.75 }); st.addItem('T3', { x: -86.56889763779527, z: 61.3, rotDeg: 90 });
  const h = st.addItem('T14', { x: 40, z: -61.57 }); st.addItem('AP15', { x: 40, z: -61.57, hostId: h.id });
  st.addItem('F20', { x: 0, z: 10, rotDeg: 180, island: true, backPanel: true });
  st.flipHinge(2);
  st.updateItem(2, { worktop: 'oak' });
  st.setAccessory('A3', 2);
  return st;
}

test('round trip: room, openings, boxings, items, flags, hosted oven, accessories all come back', () => {
  const a = kitchen(), s = a.serialize(), back = decodeDesign(encodeDesign(s));
  assert.deepEqual([back.room.width, back.room.depth, back.room.height, back.room.floor, back.room.wall, back.room.worktop, back.room.cornice], [200, 150, 96, 'herringbone', 'white', 'calacatta', 'plain']);
  assert.equal(back.finish, 'Custom RAL');
  assert.deepEqual(back.room.openings.map((o) => [o.type, o.wall, o.pos, o.width]), [['window', 'back', 0.3013, 48], ['door', 'left', 0.7, undefined]].map((r, i) => [r[0], r[1], r[2], s.room.openings[i].width]));
  assert.deepEqual(back.room.boxings.map((b) => [b.wall, b.w, b.d]), [['right', 10, 8]]);
  assert.equal(back.items.length, s.items.length);
  back.items.forEach((it, i) => {
    const o = s.items[i];
    assert.equal(it.code, o.code); assert.equal(it.rotDeg, o.rotDeg || 0);
    assert.ok(Math.abs(it.x - o.x) <= 0.005 && Math.abs(it.z - o.z) <= 0.005, `${o.code} within a hundredth of an inch`);
    assert.deepEqual([!!it.island, !!it.backPanel, it.hinge || null, it.worktop || null], [!!o.island, !!o.backPanel, o.hinge || null, o.worktop || null]);
  });
  const oven = back.items.find((i) => i.code === 'AP15'), housing = back.items.find((i) => i.code === 'T14');
  assert.equal(oven.hostId, housing.id, 'the oven still rides in its housing');
  assert.deepEqual(back.accessories, { A3: 2 });
});

test('the link is design only: no customer details, no project, and far shorter', () => {
  const a = kitchen(), url = buildShareURL(a);
  assert.match(url, /#k=k1~/);
  for (const secret of ['Jane', 'jane', 'example.com', '4417', 'trade', 'customer']) assert.ok(!url.includes(secret), `link leaks "${secret}"`);
  const old = Buffer.from(JSON.stringify(a.serialize())).toString('base64').length;
  const now = url.split('#k=')[1].length;
  assert.ok(now * 5 < old, `compact code ${now} chars vs ${old} for the old whole-state link`);
  assert.ok(/^[A-Za-z0-9\-._~%:]+$/.test(url.split('#k=')[1]), 'only URL-safe characters, nothing a chat app will mangle');
});

test('loading a #k= link restores the design and keeps the trade project in this browser', () => {
  const a = kitchen(), url = buildShareURL(a);
  const b = new Store();
  b.state.trade.units.push({ id: 1, beds: '1 Bed', letter: 'A', name: '', qty: 3, rows: [] });
  globalThis.location.hash = url.slice(url.indexOf('#'));
  assert.equal(loadFromHash(b), true);
  assert.equal(b.state.items.length, a.state.items.length);
  assert.equal(b.state.room.floor, 'herringbone');
  assert.equal(b.state.trade.units.length, 1, 'her project is untouched');
  assert.equal(b.state.customer.name, '', 'nobody else\'s details arrive with a link');
});

test('an original #d= link still opens', () => {
  const a = kitchen();
  const code = Buffer.from(JSON.stringify(a.serialize())).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  globalThis.location.hash = `#d=${code}`;
  const b = new Store();
  assert.equal(loadFromHash(b), true);
  assert.equal(b.state.items.length, a.state.items.length);
});

test('garbage is refused, never half-loaded', () => {
  assert.equal(decodeDesign('nope'), null);
  globalThis.location.hash = '#k=k1~zz';
  const b = new Store(); b.addItem('F2', { x: 0, z: 0 });
  assert.equal(loadFromHash(b), false);
  assert.equal(b.state.items.length, 1);
});
