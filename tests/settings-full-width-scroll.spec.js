// Real user report: on a wide monitor, Einstellungen's content is
// centered in a narrow column -- if the doctor's mouse drifts into the
// wide margin on either side (easy to do without noticing), the scroll
// wheel silently does nothing, since only the narrow centered column was
// ever the scrollable element. Fixed by keeping the scroll container
// full-width and centering only an inner content wrapper.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('scrolling in the wide margin outside the centered settings column still scrolls the page', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 800 });
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(500);
  await page.evaluate(() => switchView('settings'));
  await page.waitForTimeout(200);

  const dashboardBox = await page.locator('#view-settings > .dashboard').boundingBox();
  const contentBox = await page.locator('#view-settings .settings-content').boundingBox();
  // Sanity check this viewport actually reproduces a real margin outside
  // the centered column -- otherwise the test would pass for the wrong reason.
  expect(dashboardBox.width).toBeGreaterThan(contentBox.width + 200);

  const marginX = contentBox.x - 60; // well outside the centered content, still inside .dashboard
  const beforeScroll = await page.evaluate(() => document.querySelector('#view-settings > .dashboard').scrollTop);
  await page.mouse.move(marginX, dashboardBox.y + 100);
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(200);
  const afterScroll = await page.evaluate(() => document.querySelector('#view-settings > .dashboard').scrollTop);

  expect(afterScroll).toBeGreaterThan(beforeScroll);
});
