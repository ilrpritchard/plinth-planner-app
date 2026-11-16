// Send the floor plans (W2W-264): which files go, what stops the form, and the fields the
// website's inquiry handler needs (it refuses a submission with no first name, company or units).
import { PLAN_EXTS, PLAN_MAX_BYTES, PLAN_MAX_FILES, PLANS_ENDPOINT, planFileProblem, fileSize, plansFormProblem, plansFields } from '../src/core/plans.js';
import { buildEstimate, ESTIMATE_TYPES } from '../src/core/estimate.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };
const F = (name, size = 1000) => ({ name, size });

ok('the handler\'s own file types', PLAN_EXTS.join() === 'pdf,dwg,dxf,png,jpg,jpeg,heic,zip');
ok('a PDF, a DWG and a photo go', ['Level 02.pdf', 'plans.DWG', 'sketch.jpeg'].every((n) => planFileProblem(F(n)) === ''));
ok('a Word file does not', /not a PDF/.test(planFileProblem(F('notes.docx'))));
ok('a name with no extension does not', /not a PDF/.test(planFileProblem(F('pdf'))));
ok('over 25 MB does not', /over 25 MB/.test(planFileProblem(F('big.pdf', PLAN_MAX_BYTES + 1))) && planFileProblem(F('ok.pdf', PLAN_MAX_BYTES)) === '');
ok('an empty file does not', /empty/.test(planFileProblem(F('a.pdf', 0))));
ok('the same file twice is quietly skipped', planFileProblem(F('a.pdf', 5), [F('a.pdf', 5)]) === 'duplicate');
const ten = Array.from({ length: PLAN_MAX_FILES }, (_, i) => F(`p${i}.pdf`));
ok('an eleventh file is refused', /limit of 10/.test(planFileProblem(F('p11.pdf'), ten)));
ok('sizes read plainly', fileSize(2400000) === '2.3 MB' && fileSize(900) === '1 KB' && fileSize(51200) === '50 KB');

const good = { name: 'Ada Lovelace', company: 'Analytical Homes', email: 'ada@example.test', files: [F('a.pdf')] };
ok('a complete form goes', plansFormProblem(good) === '');
ok('each missing part is named', /name/.test(plansFormProblem({ ...good, name: ' ' })) && /company/.test(plansFormProblem({ ...good, company: '' }))
  && /email/.test(plansFormProblem({ ...good, email: 'ada@' })) && /floor plan/.test(plansFormProblem({ ...good, files: [] })));

const est = buildEstimate(ESTIMATE_TYPES);
const f = Object.fromEntries(plansFields({ ...good, est, ref: 'ny61' }));
ok('name splits into first and last', f.fn === 'Ada' && f.ln === 'Lovelace');
ok('email, company and units as the handler wants them', f.em === 'ada@example.test' && f.co === 'Analytical Homes' && f.un === '62');
ok('the unit mix and the link code ride along', /1 Bed 24 x 8 cabinets/.test(f.kt) && /Link code: ny61/.test(f.kt));
const bare = Object.fromEntries(plansFields({ ...good, name: 'Ada' }));
ok('with no estimate every required field is still filled', bare.fn === 'Ada' && bare.ln === '' && bare.un === 'Not given' && bare.kt.length > 0);
ok('the handler\'s required fields are never empty', ['fn', 'em', 'co', 'un'].every((k) => f[k] && bare[k]));
const proj = Object.fromEntries(plansFields({ ...good, project: 'Hudson Yards Tower', est: { from: 'project', units: 47, cabs: 567, lines: [{ beds: '1 Bed Type A', units: 22, cabs: 11 }, { beds: '2 Bed Type B', units: 15, cabs: 11 }] } }));
ok('from a project page the unit count is the project\'s own', proj.un === '47');
ok('and the project name and its unit types ride along', /^Project: Hudson Yards Tower\. From the project in the PL\/NNER: 1 Bed Type A 22 x 11 cabinets, 2 Bed Type B 15 x 11 cabinets$/.test(proj.kt));
ok('it posts to the site\'s inquiry handler', PLANS_ENDPOINT === 'https://plinthmade.com/wp-json/plinth/v1/inquire');

// the card: files go as plans[], no bare mail link is left, the copy keeps her rules
const ui = readFileSync(new URL('../src/ui/plans.js', import.meta.url), 'utf8');
const trade = readFileSync(new URL('../src/ui/trade.js', import.meta.url), 'utf8');
ok('the project toolbar passes the project\'s totals', /from: 'project', units: s\.totalUnits/.test(trade));
ok('files are sent as plans[]', ui.includes("fd.append('plans[]'"));
ok('a failed send offers the email card', ui.includes('mailFallback('));
ok('the project toolbar opens the card, not a mail link', trade.includes('id="tPlans"') && !/href="mailto:imogen@plinthmade\.com\?subject=\$\{encodeURIComponent\('Floor plans/.test(trade));
ok('no em dash, no "your"', !/—/.test(ui.replace(/\/\/.*$/gm, '')) && !/\byour\b/i.test(ui.replace(/\/\/.*$/gm, '')));

console.log(`plans: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
