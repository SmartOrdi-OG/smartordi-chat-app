// Regression test for the "+ Neuer Termin" modal's Patient field in
// secretary.html -- was a plain native <select> listing every patient,
// unusable by mouse once a practice has hundreds of patients (found via a
// user report after the Standard plan's 500-patient cap shipped). Now a
// live, server-side search combobox using the already-existing
// searchPatientsServer() (vendor/patient-data.js), with the actually-
// selected patient's name kept in the hidden #ntPatient field so
// confirmNewTermin() (which just reads its .value) needed no changes.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extraPatients) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'standard' }],
    patients: extraPatients || [],
  };
}

async function setupPage(page, extraPatients) {
  await installMockSupabase(page, seed(extraPatients), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => { openNewTerminModal(); });
}

test('typing a name shows only matching patients in the dropdown', async ({ page }) => {
  await setupPage(page, [
    { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', svnr: '111', join_status: 'approved' },
    { id: 'p2', username: 'josef.bauer', full_name: 'Josef Bauer', name: 'Josef', svnr: '222', join_status: 'approved' },
  ]);
  await page.fill('#ntPatientSearch', 'huber');
  await page.evaluate(() => ntPatientSearchDebounced());
  await expect(page.locator('#ntPatientResults')).toContainText('Maria Huber', { timeout: 2000 });
  await expect(page.locator('#ntPatientResults')).not.toContainText('Josef Bauer');
});

test('an empty search box hides the dropdown', async ({ page }) => {
  await setupPage(page, [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }]);
  await page.fill('#ntPatientSearch', 'maria');
  await page.evaluate(() => ntPatientSearchDebounced());
  await expect(page.locator('#ntPatientResults')).toBeVisible();
  await page.fill('#ntPatientSearch', '');
  await page.evaluate(() => ntPatientSearchDebounced());
  await expect(page.locator('#ntPatientResults')).toBeHidden();
});

test('clicking a result fills the search box and the hidden confirmed value', async ({ page }) => {
  await setupPage(page, [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', svnr: '111', join_status: 'approved' }]);
  await page.fill('#ntPatientSearch', 'maria');
  await page.evaluate(() => ntPatientSearchDebounced());
  await expect(page.locator('#ntPatientResults')).toContainText('Maria Huber', { timeout: 2000 });
  await page.evaluate(() => selectNtPatient(0));
  const state = await page.evaluate(() => ({
    searchValue: document.getElementById('ntPatientSearch').value,
    hiddenValue: document.getElementById('ntPatient').value,
    resultsHidden: document.getElementById('ntPatientResults').style.display === 'none',
  }));
  expect(state.searchValue).toBe('Maria Huber');
  expect(state.hiddenValue).toBe('Maria Huber');
  expect(state.resultsHidden).toBe(true);
});

test('editing the text after a selection clears the confirmed value, so a stale pick cannot be submitted', async ({ page }) => {
  await setupPage(page, [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }]);
  await page.fill('#ntPatientSearch', 'maria');
  await page.evaluate(() => ntPatientSearchDebounced());
  await expect(page.locator('#ntPatientResults')).toContainText('Maria Huber', { timeout: 2000 });
  await page.evaluate(() => selectNtPatient(0));
  await page.fill('#ntPatientSearch', 'maria h');
  await page.evaluate(() => ntPatientSearchDebounced());
  await page.waitForTimeout(400); // debounce delay (300ms) before the value actually clears
  const hiddenValue = await page.evaluate(() => document.getElementById('ntPatient').value);
  expect(hiddenValue).toBe('');
});

test('opening the modal again resets any previous search/selection', async ({ page }) => {
  await setupPage(page, [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }]);
  await page.fill('#ntPatientSearch', 'maria');
  await page.evaluate(() => ntPatientSearchDebounced());
  await expect(page.locator('#ntPatientResults')).toContainText('Maria Huber', { timeout: 2000 });
  await page.evaluate(() => selectNtPatient(0));
  await page.evaluate(() => { closeModal('newTerminModal'); openNewTerminModal(); });
  const state = await page.evaluate(() => ({
    searchValue: document.getElementById('ntPatientSearch').value,
    hiddenValue: document.getElementById('ntPatient').value,
  }));
  expect(state.searchValue).toBe('');
  expect(state.hiddenValue).toBe('');
});

test('end-to-end: searching, selecting, and confirming creates a real termin for the selected patient', async ({ page }) => {
  await setupPage(page, [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }]);
  await page.fill('#ntPatientSearch', 'maria');
  await page.evaluate(() => ntPatientSearchDebounced());
  await expect(page.locator('#ntPatientResults')).toContainText('Maria Huber', { timeout: 2000 });
  await page.evaluate(() => selectNtPatient(0));
  const result = await page.evaluate(async () => {
    document.getElementById('ntArzt').innerHTML = '<option value="u1">Dr. Sarah Ahmed</option>';
    document.getElementById('newTerminDate').value = '2026-08-20';
    document.getElementById('ntTime').innerHTML = '<option>09:00</option>';
    document.getElementById('ntEndTime').innerHTML = '<option>09:20</option>';
    document.getElementById('ntArt').value = 'Kontrolle';
    confirmNewTermin();
    await new Promise(r => setTimeout(r, 200));
    return window.__store.termine[0];
  });
  expect(result).toBeTruthy();
  expect(result.patient_name).toBe('Maria Huber');
  expect(result.arzt_id).toBe('u1');
});
