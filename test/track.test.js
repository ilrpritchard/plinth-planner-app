// Tracking (W2W-261): link codes are opaque and strictly shaped, and every lead carries its code.
import { cleanRef, refFromSearch, withRef, leadRef, track, identify, initTracking } from '../src/ui/track.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };

ok('a plain code passes, lower-cased', cleanRef('NY61') === 'ny61' && cleanRef(' sp-03 ') === 'sp-03');
ok('too short, too long, or odd characters are dropped', cleanRef('a') === '' && cleanRef('x'.repeat(25)) === '' && cleanRef('a b') === '' && cleanRef('<script>') === '' && cleanRef('-ab') === '');
ok('an email address is never a code', cleanRef('name@company.com') === '');
ok('empty and missing are no code', cleanRef('') === '' && cleanRef(null) === '' && cleanRef(undefined) === '');
ok('read from the query string', refFromSearch('?mode=project&ref=ny61') === 'ny61' && refFromSearch('?ref=NJ01&mode=project') === 'nj01');
ok('no ref, or a bad one, reads as none', refFromSearch('?mode=project') === '' && refFromSearch('?ref=a%20b') === '' && refFromSearch('') === '');
ok('a lead source carries the code', withRef('estimate:62u/588c/1 Bed 24x8', 'ny61') === 'estimate:62u/588c/1 Bed 24x8 ref:ny61');
ok('no code leaves the source alone', withRef('keep-layout:abc', '') === 'keep-layout:abc');
ok('the source stays a sane length', withRef('x'.repeat(400), 'ny61').length <= 240);
// outside a browser everything is a quiet no-op (the planner's node tests import the UI modules)
let threw = false;
try { track('estimate_view'); identify('a@b.co'); ok('no browser: no code', leadRef() === '' && initTracking() === ''); } catch { threw = true; }
ok('nothing throws without a browser', !threw);
// the link code never maps to a company in public code
const src = readFileSync(new URL('../src/ui/track.js', import.meta.url), 'utf8');
ok('the notification names the code only', /The link with code \$\{ref\}/.test(src) && !/company|developer name/i.test(src.split('async function postLinkOpened')[1].split('export function')[0]));
ok('a link opening is reported from the live planner only', /hostname !== 'planner\.plinthmade\.com'\) return;/.test(src.split('async function postLinkOpened')[1].split('export function')[0]));
ok('the planner loads the HubSpot tag for portal 245964419', /js-na2\.hs-scripts\.com\/245964419\.js/.test(readFileSync(new URL('../index.html', import.meta.url), 'utf8')));

console.log(`track: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
