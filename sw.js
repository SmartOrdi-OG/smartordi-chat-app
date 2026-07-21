// Minimal service worker -- exists only to satisfy the desktop/mobile
// install-as-app criteria (Chrome/Edge won't offer the install icon without
// a registered service worker that handles fetch). Deliberately does no
// caching of its own: this app's data is live Supabase/Realtime, so serving
// anything cached/offline here would risk showing a doctor stale patient
// data instead of a normal "you're offline" failure.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
