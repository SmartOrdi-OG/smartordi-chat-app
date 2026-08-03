// Regression test for a real production bug found live (2026-08-03):
// sw.js's fetch handler used to unconditionally call
// event.respondWith(fetch(event.request)) for EVERY request, including
// cross-origin ones -- every Supabase REST/Edge Function call goes to a
// different origin (*.supabase.co) than this app itself, and re-issuing
// that fetch from inside the service worker's own execution context broke
// its CORS preflight validation, even though the target server's CORS
// headers were perfectly correct. Confirmed live via the browser console:
// "Weiterleitung zu Stripe fehlgeschlagen" on create-billing-portal-session,
// with sw.js:16 in the failure's stack trace.
//
// Service workers can't run under this suite's file:// test pages (browsers
// require an http(s) origin to register one), so this exercises sw.js's
// actual fetch-handler logic directly instead: load its real source into a
// minimal fake `self`/event shim and check whether respondWith() gets
// called for a same-origin vs. a cross-origin request URL.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const SW_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

async function dispatchFetch(page, requestUrl) {
  return page.evaluate(({ src, requestUrl }) => {
    const fakeSelf = {
      _fetchHandler: null,
      location: { origin: 'https://chat.smartordiog.eu' },
      addEventListener(type, fn) { if (type === 'fetch') fakeSelf._fetchHandler = fn; },
    };
    // eslint-disable-next-line no-new-func
    new Function('self', src)(fakeSelf);
    let responded = false;
    fakeSelf._fetchHandler({ request: { url: requestUrl }, respondWith() { responded = true; } });
    return responded;
  }, { src: SW_SOURCE, requestUrl });
}

test('sw.js lets a cross-origin request (e.g. any Supabase call) pass through untouched', async ({ page }) => {
  await page.goto('about:blank');
  const responded = await dispatchFetch(page, 'https://ewilgwndhpxibkogxqbk.supabase.co/functions/v1/create-billing-portal-session');
  expect(responded, 'a cross-origin request must NOT be re-issued via respondWith(), or its CORS preflight breaks').toBe(false);
});

test('sw.js still intercepts a same-origin request (its only actual job -- PWA installability)', async ({ page }) => {
  await page.goto('about:blank');
  const responded = await dispatchFetch(page, 'https://chat.smartordiog.eu/doctor.html');
  expect(responded).toBe(true);
});
