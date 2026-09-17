// tradevoice.test.js — the wizard speaks TWO registers: KITCHEN (one kitchen,
// no unit type) and PROJECT (a repeatable unit type in a development). Both
// address developers, architects and builders. wizardVoice() is the single
// source for both sets of copy; these tests regression-lock the strings and
// make sure neither register slips back into homeowner romance.
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

test('kitchen register: plain, professional, one kitchen', () => {
  const v = wizardVoice(null);
  assert.equal(v.eyebrow, 'Layout');
  assert.equal(v.title, 'Lay out a kitchen');
  assert.equal(v.buildCta, 'Draft the layout →');
  assert.equal(v.building, 'Drafting the layout…');
  assert.equal(v.rerolling, 'Drafting another…');
  assert.equal(v.rerollBtn, '↻ Another layout');
  assert.equal(v.keepBtn, 'Start editing →');
  assert.equal(v.showSave, true);
});

test('kitchen register never talks like a homeowner either', () => {
  const v = wizardVoice(null);
  const banned = ['dream', 'my kitchen', 'your kitchen', 'drawing board', 'sketch', 'idea', 'love'];
  for (const k of KEYS) {
    const s = String(v[k]).toLowerCase();
    for (const b of banned) assert.ok(!s.includes(b), `kitchen ${k} contains "${b}": ${s}`);
  }
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

test('falsy unit → kitchen voice; any non-empty name → project voice', () => {
  assert.equal(wizardVoice('').eyebrow, 'Layout');
  assert.equal(wizardVoice(undefined).eyebrow, 'Layout');
  assert.equal(wizardVoice('X').eyebrow, 'Unit setup');
});
