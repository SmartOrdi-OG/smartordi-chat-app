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

// Only intercept same-origin requests -- respondWith(fetch(event.request))
// on a CROSS-origin request (e.g. every Supabase REST/Edge Function call,
// all going to *.supabase.co from this app's own different origin) breaks
// that request's CORS preflight validation once it's re-issued from
// inside the service worker's own execution context, even though the
// target server's CORS headers are perfectly correct -- the browser
// reports the type of hard-to-reproduce failure this was actually causing
// live ("Weiterleitung zu Stripe fehlgeschlagen" on create-billing-portal-
// session, and likely at least some of the "Speichern fehlgeschlagen"
// reports elsewhere, since every sb.from(...) call is exactly the same
// kind of cross-origin request). Letting a cross-origin request fall
// through untouched (never calling respondWith() for it at all) leaves
// the browser's own normal fetch path completely unaffected -- this
// service worker's only real job (satisfying the "install as app"
// criteria) never needed to see those requests in the first place.
self.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request));
});
