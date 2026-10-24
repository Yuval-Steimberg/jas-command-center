// JAS Volunteers service worker. Deliberately minimal: it caches ONE offline
// page and nothing else, so a deploy can never leave a volunteer on a stale
// app, and shift details are always read live. Navigation that fails offline
// shows offline.html.
const CACHE = 'jas-volunteers-offline-v1'
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/offline.html', '/icon-192.png'])).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return
  e.respondWith(fetch(e.request).catch(() => caches.match('/offline.html')))
})
