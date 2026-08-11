// Item 5c (real user feedback, 2026-08-11, explicitly confirmed via
// follow-up question): a patient's account marked as a child (secretary.
// html's "Kind" checkbox, or "Für mein Kind" in self-registration --
// supabase/phase65_patient_username_change_and_is_child.sql) must get the
// pediatric Anamnese (vendor/anamnese-shared.js's SPECIALTY_ANAMNESE.
// Kinderheilkunde) on their mandatory first-login screen, even when the
// practice they're registered under isn't itself a Kinderheilkunde
// practice -- that variant used to be selected purely by the PRACTICE's
// own Fachrichtung, which is unreachable for a child linked to an
// ordinary general-practice account.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function loginAndReachAnamnese(page, patient) {
  await installMockSupabase(page, { practice_settings: [{ id: true }], patients: [patient] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  page.on('dialog', d => d.dismiss());
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
  await page.waitForTimeout(500);
  await page.evaluate((row) => {
    sb.auth.signInWithPassword = () => Promise.resolve({ data: { user: { id: 'auth-p1' } }, error: null });
    sb.rpc = (name) => {
      const p = window.__store.patients.find(x => x.id === 'p1');
      if (name === 'patient_login_precheck') return Promise.resolve({ data: 'p_p1@patients.smartordi.internal', error: null });
      if (name === 'patient_get_profile') {
        return Promise.resolve({ data: [{ id: p.id, username: p.username, full_name: p.full_name, name: p.name, fach: p.fach, first_login: p.first_login, join_status: p.join_status, join_note: null, anamnese: p.anamnese, is_child: p.is_child }], error: null });
      }
      if (name === 'check_join_request_status') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
  }, patient);
  await page.fill('#username', patient.username);
  await page.fill('#password', 'demo123');
  await page.click('#loginBtn');
  await page.waitForTimeout(1000);
}

test('a child\'s account gets the pediatric Anamnese even though the practice is Allgemeinmedizin', async ({ page }) => {
  await loginAndReachAnamnese(page, {
    id: 'p1', username: 'lena.kind', full_name: 'Lena Kind', name: 'Lena',
    fach: 'Allgemeinmedizin', join_status: 'approved', first_login: false, anamnese: null,
    versicherung: 'ÖGK', svnr: '1234567890', dob: '2018-05-12', is_child: true,
  });
  const state = await page.evaluate(() => ({
    anamneseActive: document.getElementById('screen-anamnese').classList.contains('active'),
    hasPediatricField: !!document.querySelector('[data-key="an.kind.geburtsart"]'),
    specialtyTitle: document.getElementById('anamnese-specialty-title').textContent,
  }));
  expect(state.anamneseActive).toBe(true);
  expect(state.hasPediatricField, 'a child\'s Anamnese must include the pediatric (Kinderheilkunde) fields').toBe(true);
  expect(state.specialtyTitle).toBeTruthy();
});

test('an adult in the same Allgemeinmedizin practice still gets the plain Allgemeinanamnese, no pediatric fields', async ({ page }) => {
  await loginAndReachAnamnese(page, {
    id: 'p1', username: 'max.erwachsen', full_name: 'Max Erwachsen', name: 'Max',
    fach: 'Allgemeinmedizin', join_status: 'approved', first_login: false, anamnese: null,
    versicherung: 'ÖGK', svnr: '1234567890', dob: '1990-05-12', is_child: false,
  });
  const state = await page.evaluate(() => ({
    anamneseActive: document.getElementById('screen-anamnese').classList.contains('active'),
    hasPediatricField: !!document.querySelector('[data-key="an.kind.geburtsart"]'),
  }));
  expect(state.anamneseActive).toBe(true);
  expect(state.hasPediatricField).toBe(false);
});
