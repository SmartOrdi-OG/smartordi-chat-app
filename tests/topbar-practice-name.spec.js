// Regression test for the topbar showing the current practice's own name
// (getPracticeSettings().name) next to the app brand, so the topbar reads
// as THIS clinic's own installation instead of a generic app shell. No
// "Ordination" prefix is added in code -- register.html's own "z.B.
// Ordination Dr. Müller" placeholder means most real practice names
// already read that way, so hardcoding another "Ordination" would double
// it up for most real accounts.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(practiceOverrides) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'u1', practice_id: 'prac1' }],
    practices: [Object.assign({ id: 'prac1', name: 'Ordination Dr. Test', plan: 'pro' }, practiceOverrides)],
  };
}

async function setupPage(page, practiceOverrides) {
  await installMockSupabase(page, seed(practiceOverrides), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ u1: { username: 'u1', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await practiceSettingsReady; });
}

test('the topbar shows the app brand and the logged-in doctor\'s real practice name, not a hardcoded "Ordination" prefix', async ({ page }) => {
  await setupPage(page);
  const state = await page.evaluate(() => ({
    brandText: document.querySelector('.topbar-brand-name').textContent,
    practiceNameText: document.getElementById('topbarPracticeName').textContent,
  }));
  expect(state.brandText).toBe('Smartordi IT System.');
  expect(state.practiceNameText).toBe('Ordination Dr. Test');
});

test('a practice name without the word "Ordination" is still shown as-is, unmodified', async ({ page }) => {
  await setupPage(page, { name: 'Praxis am Ring' });
  const practiceNameText = await page.evaluate(() => document.getElementById('topbarPracticeName').textContent);
  expect(practiceNameText).toBe('Praxis am Ring');
});
