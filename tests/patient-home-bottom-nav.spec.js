// The bottom nav bar duplicated the home screen's own tile grid ("how do I
// get anywhere" shown twice on the one screen where the tiles already
// answer that). On request: hide it while on the home screen, keep it
// visible once inside any section so lateral switching stays a single tap.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('bottom nav is hidden on the home screen and reappears inside a section', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({
      maria: { fullName: 'Maria Huber', name: 'Maria', role: 'patient' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(500);

  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.bottom-nav')).display), 'hidden on home').toBe('none');

  await page.evaluate(() => switchView('chat'));
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.bottom-nav')).display), 'visible inside a section').not.toBe('none');

  await page.evaluate(() => goHome());
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.bottom-nav')).display), 'hidden again back on home').toBe('none');
});
