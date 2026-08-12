// Real user feedback (2026-08-12, screenshot): the language dropdown lived
// in the topbar right next to the wordmark, and on an ordinary phone width
// it crowded the wordmark out entirely (the existing @media(max-width:400px)
// rule hides .topbar-name once the row can't fit) -- worse, the dropdown
// itself was visibly clipped ("Deutscl" instead of "Deutsch") even before
// that. The language switcher is a settings-type control, not something
// needed on every screen -- it now lives in the Profil view's own new
// "Einstellungen" card instead, freeing the topbar to always show the
// wordmark.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('the language switcher lives in the Profil view, not the topbar -- so the topbar wordmark always has room', async ({ page }) => {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);

  const state = await page.evaluate(() => {
    const topbar = document.querySelector('.topbar');
    const profilView = document.getElementById('view-profil');
    const wrap = document.getElementById('langSwitcherWrap');
    return {
      wrapInsideTopbar: !!(topbar && wrap && topbar.contains(wrap)),
      wrapInsideProfil: !!(profilView && wrap && profilView.contains(wrap)),
      wrapHasSelect: !!(wrap && wrap.querySelector('select')),
      wordmarkText: document.querySelector('.topbar-name')?.textContent || '',
    };
  });
  expect(state.wrapInsideTopbar).toBe(false);
  expect(state.wrapInsideProfil).toBe(true);
  expect(state.wrapHasSelect).toBe(true);
  expect(state.wordmarkText).toContain('Smartordi');
});
