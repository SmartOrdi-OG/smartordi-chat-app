// Real user report (screenshot): opening patient.html landed on a
// completely blank page -- no tab content, no nav item highlighted --
// until they manually tapped a bottom-nav button. Root cause: none of the
// .view/.nav-item elements carry the "active" class in the markup itself,
// and nothing ever called switchView() during page init to pick a default.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('patient.html defaults to the Profil view on load instead of a blank page', async ({ page }) => {
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
    profilActive: document.getElementById('view-profil').classList.contains('active'),
    anyViewActive: !!document.querySelector('.view.active'),
    navProfilActive: document.getElementById('nav-profil').classList.contains('active'),
  }));
  expect(state.profilActive).toBe(true);
  expect(state.anyViewActive).toBe(true);
  expect(state.navProfilActive).toBe(true);
});
