// Regression test for the "Patienten einladen" QR code on secretary.html's
// dashboard (and its printable poster, #printArea) -- it used to be a
// static pre-rendered PNG pointing at the bare site root
// (https://smartordi-chat-app.vercel.app). That became a dead end once
// login.html's "Als Patient/in anmelden" link was removed (see
// tests/patient-register-deeplink.spec.js): a brand-new patient scanning it
// would land on the staff login page with no way to reach the patient
// portal at all. It's generated on the fly now, straight to the
// /patient-register deep link (vercel.json), which jumps directly to the
// self-registration screen.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function setupPage(page) {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);
}

test('the dashboard QR code and its printable poster both encode the /patient-register deep link', async ({ page }) => {
  await setupPage(page);
  const state = await page.evaluate(() => ({
    dashSrc: document.getElementById('generalQrImg')?.getAttribute('src'),
    printSrc: document.getElementById('generalPrintQrImg')?.getAttribute('src'),
    printUrlText: document.getElementById('printArea')?.querySelector('.print-url')?.textContent,
  }));
  // qrcode.js renders a data: URL -- the actual encoded text isn't
  // recoverable from the image itself, so this test relies on
  // renderQrInto() being fed the right string (verified indirectly: both
  // images must actually be populated, not the old static file, and the
  // human-readable URL printed alongside the poster's QR must match).
  expect(state.dashSrc, 'dashboard QR must be dynamically rendered, not the stale static PNG').toMatch(/^data:image/);
  expect(state.printSrc, 'print poster QR must be dynamically rendered, not the stale static PNG').toMatch(/^data:image/);
  expect(state.printUrlText).toContain('/patient-register');
});

// Regression test for the practice_id-misrouting bug found in a
// launch-readiness review (2026-07-30): the QR/deep link used to be the
// exact same bare /patient-register URL for every practice, so
// patient_join_requests's insert trigger always fell back to "the oldest
// practice in the whole database" (supabase/phase19_patient_join_requests_
// rls.sql) regardless of which practice's poster/QR a patient actually
// scanned. The URL must now embed this practice's own real id as a path
// segment (/patient-register/<id>, matching vercel.json's rewrite). The
// encoded QR image itself isn't a recoverable string, so this re-renders a
// throwaway image with the URL this test independently expects and
// compares the resulting data: URL -- qrcode.js is deterministic, so an
// identical string always produces an identical image.
test('the QR codes embed this practice\'s own real id, not just the bare /patient-register link', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'practice-real-uuid-42', name: 'Test Praxis' }],
    practice_settings: [{ id: true }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);
  const state = await page.evaluate(() => {
    const practiceId = getPracticeSettings()?.id;
    const expectedUrl = PATIENT_PORTAL_ORIGIN + '/patient-register' + (practiceId ? ('/' + practiceId) : '');
    const tmp = document.createElement('img');
    renderQrInto(tmp, expectedUrl);
    return {
      practiceId,
      expectedSrc: tmp.src,
      dashSrc: document.getElementById('generalQrImg')?.getAttribute('src'),
      printSrc: document.getElementById('generalPrintQrImg')?.getAttribute('src'),
    };
  });
  expect(state.practiceId, 'practice settings must actually be loaded for this to be a meaningful test').toBe('practice-real-uuid-42');
  expect(state.dashSrc).toBe(state.expectedSrc);
  expect(state.printSrc).toBe(state.expectedSrc);
});
