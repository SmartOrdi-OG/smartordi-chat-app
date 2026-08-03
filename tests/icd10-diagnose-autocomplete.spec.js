// Regression/coverage for the ICD-10 autocomplete added to the Kartei
// "Neu" (Verlauf) tab's "Diagnose / ICD" field (#kDiag). Purely additive:
// vendor/icd10.js loads the official Austrian ICD-10 extramural catalog
// (data/icd10.json, ~9238 codes) once and searchIcd10() filters it
// client-side as the doctor types; picking a suggestion just fills the
// same free-text #kDiag input with "CODE – Bezeichnung" -- nothing forces
// structured entry, and saveKarteiVisit() (vendor/kartei-visits.js) keeps
// reading #kDiag's plain .value exactly as before.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  };
}

async function setupPage(page) {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    await Promise.all([patientsReady, icd10Ready]);
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    switchView('clinic'); toggleKartei();
    switchKarteiTab('verlauf', document.querySelector('.kartei-tab'));
  });
}

test('the official ICD-10 catalog loads (thousands of codes, not a placeholder stub)', async ({ page }) => {
  await setupPage(page);
  const count = await page.evaluate(async () => (await icd10Ready).length);
  expect(count).toBeGreaterThan(9000);
});

test('typing a real ICD-10 code prefix surfaces it as a suggestion', async ({ page }) => {
  await setupPage(page);
  const html = await page.evaluate(async () => {
    document.getElementById('kDiag').value = 'J06.9';
    icdDiagSearch();
    return document.getElementById('kDiagResults').innerHTML;
  });
  expect(html).toContain('J06.9');
});

test('typing German diagnosis text (not a code) also surfaces matching codes', async ({ page }) => {
  await setupPage(page);
  const html = await page.evaluate(async () => {
    document.getElementById('kDiag').value = 'Cholera';
    icdDiagSearch();
    return document.getElementById('kDiagResults').innerHTML;
  });
  expect(html.toLowerCase()).toContain('cholera');
});

test('clicking a suggestion fills the field as "CODE – Bezeichnung" and hides the dropdown', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('kDiag').value = 'A00.0';
    icdDiagSearch();
    const first = document.querySelector('#kDiagResults > div');
    selectIcd10Diag(0);
    return {
      value: document.getElementById('kDiag').value,
      dropdownVisible: document.getElementById('kDiagResults').style.display,
      hadSuggestion: !!first,
    };
  });
  expect(result.hadSuggestion).toBe(true);
  expect(result.value).toContain('A00.0');
  expect(result.value).toContain('–');
  expect(result.dropdownVisible).toBe('none');
});

test('a doctor can still type and save completely free text, ignoring suggestions entirely', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('kDate').value = '2026-08-03';
    document.getElementById('kDiag').value = 'Verdacht auf etwas Seltenes, kein Code passt';
    await saveKarteiVisit();
    return window.__store.patient_visits[0].diagnose;
  });
  expect(result).toBe('Verdacht auf etwas Seltenes, kein Code passt');
});

test('no matches for gibberish input renders no suggestions and hides the dropdown', async ({ page }) => {
  await setupPage(page);
  const display = await page.evaluate(async () => {
    document.getElementById('kDiag').value = 'zzzzzznonsensxx';
    icdDiagSearch();
    return document.getElementById('kDiagResults').style.display;
  });
  expect(display).toBe('none');
});
