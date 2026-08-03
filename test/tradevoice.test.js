// tradevoice.test.js — the wizard speaks TWO registers: HOME (homeowner
// dreaming up their kitchen) and TRADE (architect / developer laying out a
// repeatable unit type). wizardVoice() is the single source for both sets of
// copy; these tests regression-lock the consumer strings and make sure the
// trade register never slips back into homeowner romance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wizardVoice } from '../src/ui/wizard.js';

const KEYS = ['eyebrow', 'title', 'sub', 'roomLead', 'applLead', 'budgetLead',
  'finishLead', 'windowNote', 'buildCta', 'building', 'rerolling', 'resultMsg',
  'rerollBtn', 'rerollTitle', 'keepBtn', 'showSave'];

test('both registers carry the full key set', () => {
  for (const v of [wizardVoice(null), wizardVoice('1 Bed Type A')]) {
    for (const k of KEYS) assert.ok(k in v, `missing ${k}`);
  }
});

test('home register: the consumer voice is unchanged', () => {
  const v = wizardVoice(null);
  assert.equal(v.eyebrow, 'The drawing board');
  assert.equal(v.title, "Let's dream up your kitchen");
  assert.equal(v.buildCta, 'Build my kitchen →');
  assert.equal(v.building, 'Sketching your kitchen…');
  assert.equal(v.rerolling, 'Back to the drawing board…');
  assert.equal(v.rerollBtn, '↻ Try another');
  assert.equal(v.keepBtn, 'Start editing →');
  assert.equal(v.showSave, true);
});

test('trade register: names the unit type, professional voice', () => {
  const v = wizardVoice('1 Bed Type A');
  assert.equal(v.eyebrow, 'Unit setup');
  assert.ok(v.title.includes('1 Bed Type A'), 'title names the unit type');
  assert.ok(v.sub.includes('every floor'), 'sub sells design-once-repeat');
  assert.equal(v.buildCta, 'Generate unit layout →');
  assert.equal(v.showSave, false, 'trade saves via the unit Done banner, not the consumer account');
});

test('trade register never talks like a homeowner', () => {
  const v = wizardVoice('Penthouse B');
  const banned = ['dream', 'my kitchen', 'your kitchen', 'drawing board', 'Sketch', 'idea'];
  for (const k of KEYS) {
    const s = String(v[k]);
    for (const b of banned) {
      assert.ok(!s.toLowerCase().includes(b.toLowerCase()), `trade ${k} contains "${b}": ${s}`);
    }
  }
});

test('falsy unit → home voice; any non-empty name → trade voice', () => {
  assert.equal(wizardVoice('').eyebrow, 'The drawing board');
  assert.equal(wizardVoice(undefined).eyebrow, 'The drawing board');
  assert.equal(wizardVoice('X').eyebrow, 'Unit setup');
});
