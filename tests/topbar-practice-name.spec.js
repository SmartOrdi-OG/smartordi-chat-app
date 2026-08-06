// Regression test for the topbar showing "Ordination <doctor name>" next to
// the app brand, so the topbar reads as THIS clinic's own installation
// instead of a generic app shell.
//
// This is built from the doctor's OWN name (session.name), not read from
// practices.name -- a real account showed exactly why: practices.name is
// free text typed once at registration, and was saved as just the single
// word "Ordination" with no doctor name at all, so reading it directly
// left the topbar looking incomplete. The doctor's own name is always
// reliably set (required at registration, already used for the topbar
// user chip and the Kalender heading), so "Ordination "+session.name is
// the more robust source.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('the topbar shows the app brand and "Ordination <doctor name>", even when practices.name itself is just the bare word "Ordination"', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'u1', practice_id: 'prac1' }],
    practices: [{ id: 'prac1', name: 'Ordination', plan: 'pro' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ u1: { username: 'u1', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await practiceSettingsReady; });
  const state = await page.evaluate(() => ({
    brandText: document.querySelector('.topbar-brand-name').textContent,
    practiceNameText: document.getElementById('topbarPracticeName').textContent,
  }));
  expect(state.brandText).toBe('Smartordi IT System.');
  expect(state.practiceNameText).toBe('Ordination Dr. Sarah Ahmed');
});

test('a different doctor\'s own name is reflected in the topbar label, independent of whatever practices.name holds', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u2', vorname: 'Klaus', nachname: 'Weber', full_name: 'Dr. Klaus Weber', role: 'arzt', fach: 'Kardiologie', is_admin: true, email: 'k@a.at', username: 'u2', practice_id: 'prac2' }],
    practices: [{ id: 'prac2', name: 'Praxis am Ring', plan: 'pro' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Klaus Weber', username: 'u2', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ u2: { username: 'u2', fullName: 'Dr. Klaus Weber', role: 'arzt', isAdmin: true, fach: 'Kardiologie' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await practiceSettingsReady; });
  const practiceNameText = await page.evaluate(() => document.getElementById('topbarPracticeName').textContent);
  expect(practiceNameText).toBe('Ordination Dr. Klaus Weber');
});

// secretary.html got the same "Smartordi IT System" + "Ordination <name>"
// topbar treatment on request (2026-08-06) -- a secretary isn't the doctor
// themselves, so this is built from practiceAdminName() (the practice's
// admin arzt, already used elsewhere in this file for the same purpose)
// rather than the logged-in secretary's own name.
test('secretary.html topbar shows "Smartordi IT System" and "Ordination <the practice\'s admin doctor>"', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Lisa Huber', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({
      'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await staffRosterReady; });
  const state = await page.evaluate(() => ({
    brandText: document.querySelector('.topbar-name').textContent,
    practiceNameText: document.getElementById('topbarPracticeName').textContent,
    logoSrc: document.querySelector('.topbar-logo img').getAttribute('src'),
  }));
  expect(state.brandText).toContain('Smartordi IT System');
  expect(state.practiceNameText).toBe('Ordination Dr. Sarah Ahmed');
  expect(state.logoSrc).toBe('logo-icon.png');
});
