// Regression test for reworking login.html's secondary actions: the
// always-visible "Jetzt registrieren ->" link and the permanent
// Datenschutz/AGB/Impressum footer row used to sit inline in the login
// form, making it read like a marketing webpage rather than an app. Both
// are now small links pinned to the viewport corners -- Registrieren still
// links straight to register.html, and Rechtliches reveals the three legal
// links in a small popover on click instead of always showing them.
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

test('Registrieren is a small corner link to register.html', async ({ page }) => {
  await openLogin(page);
  const href = await page.evaluate(() => document.querySelector('.corner-register')?.getAttribute('href'));
  expect(href).toBe('register.html');
});

test('Rechtliches reveals the legal links on click and they stay hidden until then', async ({ page }) => {
  await openLogin(page);
  const hiddenBefore = await page.evaluate(() => !document.getElementById('legalPopover').classList.contains('show'));
  expect(hiddenBefore).toBe(true);

  await page.click('.corner-legal');
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
