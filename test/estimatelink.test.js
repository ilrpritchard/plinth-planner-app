// The short link planner.plinthmade.com/estimate/?<code> (W2W-263): it lands on the Project tab with
// the code as ?ref=, and anything that is not a code is dropped rather than passed on.
import { readFileSync } from 'node:fs';
import { cleanRef } from '../src/ui/track.js';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };
const html = readFileSync(new URL('../estimate/index.html', import.meta.url), 'utf8');
const js = html.split('<script>')[1].split('</script>')[0];
const go = (search) => { let to = null; new Function('location', js)({ search, replace: (u) => { to = u; } }); return to; };

ok('a bare code', go('?ny61') === '../?mode=project&ref=ny61');
ok('upper case is lowered', go('?NJ01') === '../?mode=project&ref=nj01');
ok('the long form works too', go('?ref=sp29') === '../?mode=project&ref=sp29');
ok('parameters a mail client adds are ignored', go('?ny61&utm_source=x&fbclid=y') === '../?mode=project&ref=ny61' && go('?ny61=&x=1') === '../?mode=project&ref=ny61');
ok('no code opens the estimate with none', go('') === '../?mode=project' && go('?') === '../?mode=project');
ok('an odd code is dropped', go('?%3Cscript%3E') === '../?mode=project' && go('?a') === '../?mode=project' && go('?name@company.com') === '../?mode=project');
ok('whatever it passes on, the planner accepts', ['?ny61', '?NJ01', '?ref=sp29'].every((s) => cleanRef(go(s).split('ref=')[1]) !== ''));
ok('not indexed', /name="robots" content="noindex"/.test(html));

console.log(`estimatelink: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
