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

// Real user feedback (2026-08-14), a follow-up on the topbar-name change:
// the name belongs above the home-screen tile grid too, as a clear
// heading -- not just in the topbar.
test('the home screen shows the patient\'s full name as a heading above the tile grid', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({
      maria: { fullName: 'Maria Huber', name: 'Maria', role: 'patient' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(500);
  const text = await page.evaluate(() => document.getElementById('homeGreetingName').textContent);
  expect(text).toBe('Maria Huber');
});

// Real user feedback (2026-08-14): a tap on the bottom-most nav icons
// risked landing close enough to the iOS home-indicator swipe-up gesture
// zone to trigger it instead of registering as a plain tap -- the nav
// needs real breathing room above env(safe-area-inset-bottom), not flush
// against it.
test('the bottom nav keeps real padding above the safe-area inset, not just the inset itself', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({
      maria: { fullName: 'Maria Huber', name: 'Maria', role: 'patient' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(500);
  await page.evaluate(() => switchView('chat'));
  await page.waitForTimeout(400);
  const paddingBottom = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.bottom-nav')).paddingBottom));
  // env(safe-area-inset-bottom) is 0 in this headless/non-notched test
  // environment, so this is purely the fixed buffer -- must be
  // meaningfully more than the original 4px flush-to-inset value.
  expect(paddingBottom).toBeGreaterThanOrEqual(14);
});
