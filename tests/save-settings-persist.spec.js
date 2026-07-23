// Regression test for doctor.html's saveSettings(): the "Praxisprofil" card
// in Einstellungen lets a doctor edit their own displayed name and
// Fachrichtung, but the "Speichern" button only ever updated the on-screen
// text (nav name, uwVon referral letterhead field) and a device-wide
// localStorage shadow copy -- it never wrote to staff_profiles at all.
// Adresse/Telefon on the same card already persist immediately via
// savePracticeSettings()'s onchange handler; Name/Fachrichtung silently
// reverted to the old value on reload or on any other device.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed', practice_id: 'prac1' }],
    practices: [{ id: 'prac1', name: 'Ordination Dr. Ahmed', adresse: 'Alte Adresse 1, Linz', tel: '+43 1 111', plan: 'pro', trial_start: '2026-01-01T00:00:00Z', payment_method: null, created_at: '2026-01-01T00:00:00Z' }],
  };
}

async function setup(page) {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ u1: { username: 'u1', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
}

test('saveSettings() actually persists the edited name/Fachrichtung to staff_profiles, not just the DOM', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    document.getElementById('setArztName').value = 'Dr. Julia Neumann';
    document.getElementById('setFach').value = 'Kardiologie';
    await saveSettings();
    return {
      toast: document.getElementById('toast')?.textContent || '',
      navName: document.getElementById('doctorNameDisplay')?.textContent,
      serverRow: window.__store.staff_profiles.find(p => p.id === 'u1'),
      sessionName: JSON.parse(sessionStorage.getItem('smartordi_user')).name,
    };
  });
  expect(result.toast).toContain('gespeichert');
  expect(result.navName).toBe('Dr. Julia Neumann');
  expect(result.serverRow.full_name, 'must actually reach the database, not just the on-screen text').toBe('Dr. Julia Neumann');
  expect(result.serverRow.fach).toBe('Kardiologie');
  expect(result.sessionName, 'the cached session name should stay in sync too').toBe('Dr. Julia Neumann');
});

test('a real save failure shows an error toast instead of a false success, and the name survives a reload', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    window.__forceError = { staff_profiles: 'simulated DB error' };
    document.getElementById('setArztName').value = 'Dr. Julia Neumann';
    document.getElementById('setFach').value = 'Kardiologie';
    await saveSettings();
    delete window.__forceError;
    return {
      toast: document.getElementById('toast')?.textContent || '',
      serverRow: window.__store.staff_profiles.find(p => p.id === 'u1'),
    };
  });
  expect(result.toast).not.toContain('✓');
  expect(result.toast).toContain('fehlgeschlagen');
  expect(result.serverRow.full_name, 'the old name must still be on file after a failed save').toBe('Dr. Sarah Ahmed');
});
