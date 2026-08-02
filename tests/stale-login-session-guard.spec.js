// Regression test for a real production incident: sessionStorage.
// smartordi_user (this app's own "am I logged in" flag) can outlive the
// actual Supabase Auth session it was created from -- the observed
// symptom was doctor.html rendering normally (name/menu all fine) while
// every refresh*() call silently returned zero rows under RLS (an
// unauthenticated request just doesn't match any "to authenticated"
// policy, which is an empty result, not a Postgres error, so the existing
// critical-data-error banner never fired). Logging out and back in fixed
// it completely. guardAgainstStaleLoginSession() (vendor/staff-accounts.js)
// now detects this mismatch itself and forces a clean re-login with a
// clear message, instead of silently rendering an empty-looking app.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

const STAFF_CASES = [
  { role: 'doctor', file: 'doctor.html', user: { role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true } },
  { role: 'secretary', file: 'secretary.html', user: { role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false } },
];

for (const { role, file, user } of STAFF_CASES) {
  test(`${role}: a genuinely stale/mismatched session forces a clean re-login instead of silently rendering empty`, async ({ page }) => {
    await installMockSupabase(page, {
      staff_profiles: [{ id: 'dr.ahmed', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
      practice_settings: [{ id: true }],
    });
    // Guarded to this page only -- the redirect this test provokes lands
    // on login.html, which loads this same addInitScript again (it applies
    // to every navigation in the page), and login.html must NOT see a
    // re-populated session or window.__forceNoSession from a completely
    // unrelated page.
    await page.addInitScript(({ u, f }) => {
      if (!location.pathname.endsWith('/' + f)) return;
      sessionStorage.setItem('smartordi_user', JSON.stringify(u));
      window.__forceNoSession = true;
    }, { u: user, f: file });
    await page.goto('file://' + path.join(__dirname, '..', file));
    await page.waitForURL(/login\.html\?expired=1$/, { timeout: 5000 });
    expect(page.url()).toContain('login.html?expired=1');
    const cachedAfter = await page.evaluate(() => sessionStorage.getItem('smartordi_user'));
    expect(cachedAfter, 'the stale flag must be cleared, not just left behind for the next load').toBeNull();
    const noticeVisible = await page.evaluate(() => document.getElementById('errorMsg')?.classList.contains('show'));
    expect(noticeVisible, 'login.html should explain why it bounced back, not look like an unexplained blank form').toBe(true);
  });

  test(`${role}: a genuinely valid session is left alone -- no redirect, no data wiped`, async ({ page }) => {
    await installMockSupabase(page, {
      staff_profiles: [{ id: 'dr.ahmed', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
      practice_settings: [{ id: true }],
    });
    await page.addInitScript((u) => { sessionStorage.setItem('smartordi_user', JSON.stringify(u)); }, user);
    await page.goto('file://' + path.join(__dirname, '..', file));
    await page.waitForTimeout(1000);
    expect(page.url()).toContain(file);
    const cached = await page.evaluate(() => sessionStorage.getItem('smartordi_user'));
    expect(cached, 'a valid session must not be cleared').not.toBeNull();
  });
}

test('patient.html: a local-only/demo patient session is never redirected, even with no real sb.auth session', async ({ page }) => {
  await installMockSupabase(page, {});
  await page.addInitScript(() => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'patient', name: 'Maria', username: 'maria.huber' }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    window.__forceNoSession = true;
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(1000);
  expect(page.url(), 'patient sessions are out of scope for this guard -- many are legitimately local-only').toContain('patient.html');
  const cached = await page.evaluate(() => sessionStorage.getItem('smartordi_user'));
  expect(cached).not.toBeNull();
});
