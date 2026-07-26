// Regression test for reworking login.html's secondary actions: the
// always-visible "Jetzt registrieren ->" link and the permanent
// Datenschutz/AGB/Impressum footer row used to sit inline in the login
// form, making it read like a marketing webpage rather than an app.
//
// Desktop (>=1024px, where the branded green side panel is shown) now
// shows "Jetzt registrieren ->" and a "Rechtliches" link under the
// feature tiles in that panel -- Rechtliches reveals the three legal
// links inline, right below it, on click.
//
// Mobile (<1024px, no side panel) groups the same two into one small
// pinned corner instead ("Registrieren · Rechtliches"), with the legal
// links revealed in a small popover on click -- same click-to-reveal
// behavior as desktop, just positioned differently since there's no
// green panel to anchor to.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function openLogin(page) {
  await installMockSupabase(page, {}, () => {});
  await page.goto('file://' + path.join(__dirname, '..', 'login.html'));
  await page.waitForTimeout(500);
}

test('the login form itself only shows the login fields, not registration or legal links inline', async ({ page }) => {
  await openLogin(page);
  const inlineText = await page.evaluate(() => document.getElementById('normalLoginForm').textContent);
  expect(inlineText).not.toContain('registrieren');
  const hasInlineLegalLinks = await page.evaluate(() =>
    !!document.querySelector('#normalLoginForm a[href="datenschutz.html"], #normalLoginForm a[href="agb.html"], #normalLoginForm a[href="impressum.html"]')
  );
  expect(hasInlineLegalLinks).toBe(false);
});

test('desktop: Registrieren + Rechtliches show under the feature tiles, legal links reveal on click', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLogin(page);

  const mobileLinksHidden = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.mobile-secondary-links')).display === 'none'
  );
  expect(mobileLinksHidden, 'the mobile pinned corner must not also show on desktop').toBe(true);

  const registerHref = await page.evaluate(() =>
    document.querySelector('.brand-secondary-links a[href="register.html"]')?.getAttribute('href')
  );
  expect(registerHref).toBe('register.html');

  const hiddenBefore = await page.evaluate(() => !document.getElementById('brandLegalPopover').classList.contains('show'));
  expect(hiddenBefore).toBe(true);

  await page.click('.brand-secondary-links > a:last-of-type');
  const state = await page.evaluate(() => ({
    shown: document.getElementById('brandLegalPopover').classList.contains('show'),
    links: Array.from(document.querySelectorAll('#brandLegalPopover a')).map(a => a.getAttribute('href')),
  }));
  expect(state.shown).toBe(true);
  expect(state.links).toEqual(['datenschutz.html', 'agb.html', 'impressum.html']);

  await page.click('#email');
  const shownAfterOutsideClick = await page.evaluate(() => document.getElementById('brandLegalPopover').classList.contains('show'));
  expect(shownAfterOutsideClick).toBe(false);
});

test('mobile: Registrieren + Rechtliches share one pinned corner, with legal links behind a popover', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLogin(page);

  const registerHref = await page.evaluate(() =>
    document.querySelector('.mobile-secondary-links a[href="register.html"]')?.getAttribute('href')
  );
  expect(registerHref).toBe('register.html');

  const hiddenBefore = await page.evaluate(() => !document.getElementById('legalPopover').classList.contains('show'));
  expect(hiddenBefore).toBe(true);

  await page.click('.mobile-secondary-links a:last-child');
  const state = await page.evaluate(() => ({
    shown: document.getElementById('legalPopover').classList.contains('show'),
    links: Array.from(document.querySelectorAll('#legalPopover a')).map(a => a.getAttribute('href')),
  }));
  expect(state.shown).toBe(true);
  expect(state.links).toEqual(['datenschutz.html', 'agb.html', 'impressum.html']);

  // Clicking elsewhere closes it again instead of leaving it stuck open.
  await page.click('#email');
  const shownAfterOutsideClick = await page.evaluate(() => document.getElementById('legalPopover').classList.contains('show'));
  expect(shownAfterOutsideClick).toBe(false);
});
