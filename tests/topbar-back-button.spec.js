// Regression test for the top bar's "Zurück" button (doctor.html) --
// user report: it used window.history.back(), which for a home-screen-
// installed app follows whatever the browser's own navigation history
// happens to be (not necessarily anything inside Smartordi), so it could
// land anywhere. goBack() now always returns to Kalender, the app's real
// home screen, regardless of browsing history.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('the topbar "Zurück" button always returns to Kalender, not wherever browser history points', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const state = await page.evaluate(() => {
    // Navigate away from Kalender first, so goBack() actually has to do
    // something (and browser history now points at "dashboard", not Kalender).
    openWindow('dashboard');
    goBack();
    return {
      onKalender: document.body.classList.contains('mobile-tuhome-active'),
      anyViewActive: !!document.querySelector('.view.active'),
      kalenderNavActive: document.getElementById('mnav-kalender')?.classList.contains('active'),
    };
  });
  expect(state.onKalender, 'goBack() lands on the Kalender home screen').toBe(true);
  expect(state.anyViewActive, 'no other .view stays active').toBe(false);
  expect(state.kalenderNavActive, 'the mobile Kalender nav icon is marked active').toBe(true);
});
