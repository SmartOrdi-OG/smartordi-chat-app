// Real user report (screenshot): opening patient.html landed on a
// completely blank page -- no tab content, no nav item highlighted --
// until they manually tapped a bottom-nav button. Root cause: none of the
// .view/.nav-item elements carry the "active" class in the markup itself,
// and nothing ever called switchView() during page init to pick a default.
//
// On request, the app now opens to a home screen (#view-home, icon tiles
// for Chat/Termine/Dokumente/Profil) instead of jumping straight into
// Profil -- this test was updated to match, but keeps covering the
// original bug (never a blank page with nothing highlighted).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('patient.html defaults to the Home view on load instead of a blank page', async ({ page }) => {
  // The real report was a phone screenshot -- mobile (<1024px) is where
  // switchView() actually toggles the .active class; >=1024px takes an
  // entirely different "windowed desktop" branch (win-open/win-fullscreen).
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({
      maria: { fullName: 'Maria Huber', name: 'Maria', role: 'patient' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(600);

  const state = await page.evaluate(() => ({
    homeActive: document.getElementById('view-home').classList.contains('active'),
    anyViewActive: !!document.querySelector('.view.active'),
    navHomeActive: document.getElementById('nav-home').classList.contains('active'),
    backBtnHidden: getComputedStyle(document.getElementById('topbarBackBtn')).display === 'none',
  }));
  expect(state.homeActive).toBe(true);
  expect(state.anyViewActive).toBe(true);
  expect(state.navHomeActive).toBe(true);
  expect(state.backBtnHidden, 'the back button has nowhere to go from the home screen itself').toBe(true);
});

// Desktop (windowed) mode is a completely different UX (an always-visible
// sidebar already serves the "where do I go" purpose #view-home covers on
// mobile) -- it must keep defaulting to Profil, not silently show nothing
// (#view-home is force-hidden by CSS at >=1024px).
test('patient.html defaults to the Profil window on a desktop-width load, not the (desktop-hidden) home screen', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({
      maria: { fullName: 'Maria Huber', name: 'Maria', role: 'patient' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(600);

  const state = await page.evaluate(() => ({
    profilWinOpen: document.getElementById('view-profil').classList.contains('win-open'),
    homeVisible: getComputedStyle(document.getElementById('view-home')).display !== 'none',
  }));
  expect(state.profilWinOpen).toBe(true);
  expect(state.homeVisible).toBe(false);
});
