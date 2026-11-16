// sw.js (W2W-266): the worker that keeps the planner's files in step after an update. It is run here
// against a fake browser: it must ask the server afresh for pages, scripts and styles on this site,
// leave everything else alone, store nothing, and fall back to normal loading on any failure.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.error('✗ ' + n)); };
const src = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function boot(fetchImpl) {
  const handlers = {}; const calls = [];
  const self = { location: { origin: 'https://planner.plinthmade.com' }, clients: { claim: () => Promise.resolve('claimed') }, skipWaiting: () => { calls.push('skipWaiting'); },
    addEventListener: (t, f) => { handlers[t] = f; } };
  const fetch = (input, init) => { calls.push({ url: typeof input === 'string' ? input : input.url, cache: init && init.cache, whole: typeof input !== 'string' }); return fetchImpl(input, init); };
  new Function('self', 'fetch', 'URL', src)(self, fetch, URL);
  return { handlers, calls };
}
const req = (url, destination = 'script', method = 'GET') => ({ url, destination, method });
async function run(w, request) {
  let answered = null;
  w.handlers.fetch({ request, respondWith: (p) => { answered = p; } });
  return answered ? { handled: true, res: await answered } : { handled: false };
}
const fresh = { ok: true, redirected: false, tag: 'fresh' };

let w = boot(async () => fresh);
let r = await run(w, req('https://planner.plinthmade.com/src/ui/trade.js'));
ok('a script on this site is asked for afresh', r.handled && r.res === fresh && w.calls.at(-1).cache === 'no-cache');
for (const d of ['document', 'style']) { w = boot(async () => fresh); r = await run(w, req('https://planner.plinthmade.com/x', d)); ok(`a ${d} too`, r.handled && w.calls.at(-1).cache === 'no-cache'); }
for (const d of ['image', 'font', '', 'audio']) { w = boot(async () => fresh); r = await run(w, req('https://planner.plinthmade.com/x', d)); ok(`"${d || 'data'}" requests are left alone`, !r.handled && w.calls.length === 0); }
w = boot(async () => fresh);
ok('other sites are left alone', !(await run(w, req('https://esm.sh/@supabase/supabase-js'))).handled && !(await run(w, req('https://www.googletagmanager.com/gtag/js'))).handled);
ok('uploads and other non-GET requests are left alone', !(await run(w, req('https://planner.plinthmade.com/x', 'script', 'POST'))).handled);

// failures fall back to the browser's normal loading, with the original request
const normal = { ok: true, tag: 'normal' };
w = boot(async (input, init) => { if (init && init.cache === 'no-cache') throw new Error('offline'); return normal; });
r = await run(w, req('https://planner.plinthmade.com/src/main.js'));
ok('offline: the normal load is used', r.res === normal && w.calls.at(-1).whole === true);
w = boot(async (input, init) => (init && init.cache === 'no-cache' ? { ok: false, status: 404 } : normal));
ok('a missing file arrives the normal way', (await run(w, req('https://planner.plinthmade.com/src/gone.js'))).res === normal);
w = boot(async (input, init) => (init && init.cache === 'no-cache' ? { ok: true, redirected: true } : normal));
ok('a redirected reply is not used for a page load', (await run(w, req('https://planner.plinthmade.com/estimate', 'document'))).res === normal);

// it takes over at once and stores nothing
w = boot(async () => fresh); w.handlers.install(); let waited = null; w.handlers.activate({ waitUntil: (p) => { waited = p; } });
ok('it takes over without waiting for a second visit', w.calls.includes('skipWaiting') && (await waited) === 'claimed');
const code = src.replace(/\/\/.*$/gm, '');
ok('it stores nothing', !/caches\.|indexedDB|\.put\(|\.add\(/.test(code));
ok('how to switch it off is written in the file', /TO SWITCH IT OFF/.test(src) && /registration\.unregister\(\)/.test(src));

// the page registers it on the live host only, before the planner's own code
ok('registered on the live host only', /location\.hostname !== 'planner\.plinthmade\.com'\) return;/.test(html) && /serviceWorker\.register\('\.\/sw\.js'\)/.test(html));
ok('registered before the planner loads', html.indexOf("register('./sw.js')") < html.indexOf('src="./src/main.js"'));
ok('a failed start reloads once, never in a loop', /plnr-sw-reloaded/.test(html) && /if \(had \|\| window\.PlinthPlanner\) return;/.test(html));

console.log(`swfresh: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
