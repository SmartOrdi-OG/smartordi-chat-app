// Regression test for supabase/phase73_patient_get_practice_contact.sql --
// a real user report: patient.html's "Meine Ordination" card always showed
// "—" for Adresse/Telefon, even when the doctor had filled both in
// correctly in Einstellungen. Root cause: updatePracticeIdentityUI() reads
// them via getPracticeSettings() (vendor/staff-accounts.js), which does a
// direct sb.from('practices').select(...) gated by RLS scoped to
// current_practice_id() -- which resolves via staff_profiles, so it's
// always null for a real patient/guardian session (same class of bug as
// tests/patient-staff-roster.spec.js's patient_get_staff_roster() fix).
// Invisible to this whole suite before now because the mock Supabase
// doesn't simulate RLS at all -- this test leaves the practices table
// completely unseeded on purpose, so the OLD direct-select path would
// return nothing even in the mock, proving the fix actually goes through
// the new RPC rather than happening to work by coincidence.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function setupPatientPage(page, rpcOverrides) {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  await page.evaluate((overrides) => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [{ id: 'p1', username: 'maria', name: 'Maria', full_name: 'Maria Huber', dob: '1985-01-01', first_login: false }], error: null });
      if (overrides[name] !== undefined) return Promise.resolve(overrides[name]);
      return Promise.resolve({ data: [], error: null });
    };
  }, rpcOverrides || {});
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);
}

test('a real patient session shows the real Adresse/Telefon from patient_get_practice_contact(), not "—"', async ({ page }) => {
  await setupPatientPage(page, {
    patient_get_practice_contact: {
      data: [{ adresse: 'Edlbacherstrasse 13, 4020 Linz', tel: '+43 660 1234567' }],
      error: null,
    },
  });
  const texts = await page.evaluate(() => ({
    adresse: document.getElementById('profilOrdAdresse').textContent,
    tel: document.getElementById('profilOrdTel').textContent,
  }));
  expect(texts.adresse).toBe('Edlbacherstrasse 13, 4020 Linz');
  expect(texts.tel).toBe('+43 660 1234567');
});

test('a failed patient_get_practice_contact() call leaves "—" instead of crashing the page', async ({ page }) => {
  await setupPatientPage(page, {
    patient_get_practice_contact: { data: null, error: { message: 'simulated db error' } },
  });
  const texts = await page.evaluate(() => ({
    adresse: document.getElementById('profilOrdAdresse').textContent,
    tel: document.getElementById('profilOrdTel').textContent,
  }));
  expect(texts.adresse).toBe('—');
  expect(texts.tel).toBe('—');
});
