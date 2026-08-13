// Real user report: logging out of patient.html landed on login.html --
// the STAFF (doctor/secretary) login page -- instead of patient-login.html.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('logging out of patient.html redirects to patient-login.html, not the staff login page', async ({ page }) => {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({
      maria: { fullName: 'Maria Huber', name: 'Maria', role: 'patient' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(500);
  // logout() now shows its own in-app confirm modal (showConfirmDialog())
  // instead of a native window.confirm() -- real user feedback, 2026-08-13
  // (a screenshot showed the native dialog looking out of place). Click
  // its own OK button instead of relying on Playwright's dialog handler.
  await page.click('.topbar-logout');
  await page.waitForSelector('#genericConfirmModal.show');
  await Promise.all([
    page.waitForNavigation(),
    page.click('#genericConfirmOkBtn'),
  ]);
  expect(page.url().endsWith('/patient-login.html')).toBe(true);
});
