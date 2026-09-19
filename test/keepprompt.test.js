// "Keep this layout?" timing (core/keepprompt.js): active time + a real kitchen,
// or a they-care moment + two more minutes; once a session; never where it nags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeepTracker, KEEP_RULES } from '../src/core/keepprompt.js';

const clock = () => { let t = 1e6; const now = () => t; now.tick = (ms) => { t += ms; }; return now; };
const use = (tr, now, ms, step = 10e3) => { for (let d = 0; d < ms; d += step) { now.tick(step); tr.activity(); } };
const home = (cabinets = 12) => ({ cabinets, mode: 'home', designing: false, signedIn: false, busy: false });

test('five ACTIVE minutes with a kitchen in the room; a drafted layout counts straight away', () => {
  const now = clock(), tr = createKeepTracker(now);
  tr.activity();
  use(tr, now, 4 * 60e3);
  assert.equal(tr.shouldShow(home()), false, 'four minutes: not yet');
  use(tr, now, 61e3);
  assert.equal(tr.shouldShow(home(12)), true, 'a wizard layout of 12 cabinets counts like 12 dragged ones');
  assert.equal(tr.shouldShow(home(5)), false, 'but not for someone with a handful placed');
});

test('an idle tab never earns a prompt', () => {
  const now = clock(), tr = createKeepTracker(now);
  tr.activity(); now.tick(40 * 60e3); tr.activity();
  assert.equal(tr.activeMs, 0, 'a 40 minute gap is not activity');
  assert.equal(tr.shouldShow(home()), false);
});

test('a they-care moment brings it forward to two more active minutes', () => {
  for (const kinds of [['start-editing'], ['kept-idea'], ['reroll', 'reroll']]) {
    const now = clock(), tr = createKeepTracker(now);
    tr.activity(); use(tr, now, 30e3);
    for (const k of kinds) tr.signal(k);
    use(tr, now, 110e3);
    assert.equal(tr.shouldShow(home()), false, `${kinds}: under two minutes after`);
    use(tr, now, 20e3);
    assert.equal(tr.shouldShow(home()), true, `${kinds}: two minutes after`);
  }
  const now = clock(), tr = createKeepTracker(now);
  tr.activity(); tr.signal('reroll'); use(tr, now, 3 * 60e3);
  assert.equal(tr.shouldShow(home()), false, 'a single re-roll is just browsing');
});

test('never in Project mode, mid unit-design, signed in, or over a dialog; once per session', () => {
  const now = clock(), tr = createKeepTracker(now);
  tr.activity(); use(tr, now, KEEP_RULES.activeMs + 10e3);
  for (const block of [{ mode: 'trade' }, { designing: true }, { signedIn: true }, { busy: true }]) assert.equal(tr.shouldShow({ ...home(), ...block }), false, JSON.stringify(block));
  assert.equal(tr.shouldShow(home()), true);
  tr.finish();
  use(tr, now, 10 * 60e3);
  assert.equal(tr.shouldShow(home()), false, 'shown or dismissed once: never again this session');
});
