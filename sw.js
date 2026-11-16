// sw.js — keeps the planner's files in step with each other after an update (W2W-266).
//
// GitHub Pages lets a browser keep every file for 10 minutes. After a push, a browser that
// visited recently used to load a MIX of old and new modules for up to 10 minutes, and a
// mix can fail to start (16 Nov 2026: the planner loaded as an empty shell).
//
// This worker makes the browser ASK the server whether each page, script and stylesheet
// has changed before using its kept copy. Unchanged files come back as a tiny "not
// modified" reply; changed files come back new; the set is always the current one.
//
// It stores NOTHING: no Cache Storage, no offline copy. Anything it does not handle, or
// any error, falls straight through to the browser's normal loading, so it can never
// serve something older than the browser would have served without it.
//
// TO SWITCH IT OFF: replace this file's contents with
//   self.addEventListener('install', () => self.skipWaiting());
//   self.addEventListener('activate', () => self.registration.unregister());
// and push. Never just delete the file: browsers that have it keep the old one.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const CHECKED = new Set(['document', 'script', 'style']);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !CHECKED.has(req.destination)) return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
      // a redirected reply cannot answer a page load, and an error page should arrive the normal way
      if (res && res.ok && !res.redirected) return res;
    } catch { /* offline, or the request was blocked: load it the normal way */ }
    return fetch(req);
  })());
});
