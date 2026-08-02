// Regression test for removing login.html's secondary actions entirely.
// "Jetzt registrieren ->" and the Datenschutz/AGB/Impressum "Rechtliches"
// popover used to sit under the feature tiles (desktop) or in a pinned
// mobile corner -- the user decided a doctor logging in every day
// shouldn't see anything on that screen except the login form itself.
// New practices are onboarded via a separate register.html link instead
// (which already carries its own Datenschutz/AGB/Impressum footer), not
// discovered from the login page.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function openLogin(page) {
  await installMockSupabase(page, {}, () => {});
  await page.goto('file://' + path.join(__dirname, '..', 'login.html'));
  await page.waitForTimeout(500);
}

test('login.html shows only the login form -- no Registrieren or Rechtliches links anywhere, on desktop or mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLogin(page);
  const desktopState = await page.evaluate(() => ({
    hasRegisterLink: !!document.querySelector('a[href="register.html"]'),
    hasLegalLinks: !!document.querySelector('a[href="datenschutz.html"], a[href="agb.html"], a[href="impressum.html"]'),
    bodyText: document.body.textContent,
  }));
  expect(desktopState.hasRegisterLink).toBe(false);
  expect(desktopState.hasLegalLinks).toBe(false);
  expect(desktopState.bodyText).not.toContain('Rechtliches');
  expect(desktopState.bodyText.toLowerCase()).not.toContain('registrieren');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForTimeout(500);
  const mobileState = await page.evaluate(() => ({
    hasRegisterLink: !!document.querySelector('a[href="register.html"]'),
    hasLegalLinks: !!document.querySelector('a[href="datenschutz.html"], a[href="agb.html"], a[href="impressum.html"]'),
  }));
  expect(mobileState.hasRegisterLink).toBe(false);
  expect(mobileState.hasLegalLinks).toBe(false);
});
