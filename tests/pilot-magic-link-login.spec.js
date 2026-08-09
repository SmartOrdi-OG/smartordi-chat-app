// Regression test for the Pilot-Konto passwordless-login flow (supabase/
// functions/pilot-login + send-pilot-login-link, phase60_pilot_login_links.sql):
// clicking the "Jetzt anmelden" button in the pilot's email redirects them
// through Supabase's own magic-link verify endpoint, which lands back on
// login.html with #...&type=magiclink and a real SIGNED_IN session --
// login.html's onAuthStateChange must recognize that specific case (and
// ONLY that case, not an ordinary doLogin() password sign-in, which fires
// the same SIGNED_IN event) and route straight into the right dashboard
// without ever showing a login form.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function gotoWithHash(page, hash) {
  await installMockSupabase(page, {
    staff_profiles: [
      { id: 'pilot-arzt-uid', role: 'arzt', full_name: 'Dr. Pilot Arzt', is_admin: true },
      { id: 'pilot-sek-uid', role: 'sekretaerin', full_name: 'Pilot Sekretärin', is_admin: false },
    ],
  });
  await page.goto('file://' + path.join(__dirname, '..', 'login.html') + hash);
  await page.waitForTimeout(500);
}

test('a magic-link SIGNED_IN callback for a pilot arzt sets the session and redirects to doctor.html', async ({ page }) => {
  await gotoWithHash(page, '#access_token=tok123&type=magiclink');
  const result = await page.evaluate(async () => {
    await window.__authStateChangeCallback('SIGNED_IN', { user: { id: 'pilot-arzt-uid' } });
    return { sessionUser: JSON.parse(sessionStorage.getItem('smartordi_user') || 'null') };
  });
  expect(result.sessionUser).toEqual({ role: 'arzt', name: 'Dr. Pilot Arzt', username: 'pilot-arzt-uid', isAdmin: true });
});

test('a magic-link SIGNED_IN callback for a pilot secretary redirects with the right role', async ({ page }) => {
  await gotoWithHash(page, '#access_token=tok456&type=magiclink');
  const result = await page.evaluate(async () => {
    await window.__authStateChangeCallback('SIGNED_IN', { user: { id: 'pilot-sek-uid' } });
    return { sessionUser: JSON.parse(sessionStorage.getItem('smartordi_user') || 'null') };
  });
  expect(result.sessionUser).toEqual({ role: 'sekretaerin', name: 'Pilot Sekretärin', username: 'pilot-sek-uid', isAdmin: false });
});

test('a plain SIGNED_IN event WITHOUT type=magiclink in the URL (an ordinary doLogin() password sign-in) is ignored by the magic-link handler', async ({ page }) => {
  await gotoWithHash(page, '');
  const result = await page.evaluate(async () => {
    sessionStorage.removeItem('smartordi_user');
    await window.__authStateChangeCallback('SIGNED_IN', { user: { id: 'pilot-arzt-uid' } });
    return sessionStorage.getItem('smartordi_user');
  });
  expect(result, 'a bare SIGNED_IN event must not set a session unless it came from a magic-link callback').toBeNull();
});

test('a magic-link callback for an unknown account shows an error instead of silently signing in', async ({ page }) => {
  await gotoWithHash(page, '#access_token=tok789&type=magiclink');
  const result = await page.evaluate(async () => {
    await window.__authStateChangeCallback('SIGNED_IN', { user: { id: 'no-such-staff' } });
    return {
      sessionUser: sessionStorage.getItem('smartordi_user'),
      errorVisible: document.getElementById('errorMsg').classList.contains('show'),
      errorText: document.getElementById('errorText').textContent,
    };
  });
  expect(result.sessionUser).toBeNull();
  expect(result.errorVisible).toBe(true);
  expect(result.errorText).toContain('Kein Praxisprofil');
});
