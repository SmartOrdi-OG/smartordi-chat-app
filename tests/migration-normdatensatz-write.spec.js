// Regression test for Phase 2 of the Praxisdaten-Migration feature: actually
// writing the parsed ENDS1 Stammdaten into real patient accounts
// (confirmMigrationImport() in doctor.html), reusing the exact same
// account-creation/duplicate-matching logic secretary.html's CSV import uses
// (vendor/patient-account-creation.js, extracted from secretary.html this
// same phase -- see tests/csv-import.spec.js for the equivalent CSV-side
// coverage of that shared logic).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsZipMock } = require('./helpers/jszipStub');

function ends1Line(patientNr, field, value) {
  return String(patientNr).padStart(10, '0') + '#P' + field + '00000000' + '0000' + value + '\r\n';
}

async function setupAdmin(page, sampleText, seedPatients) {
  const sampleBase64 = Buffer.from(sampleText, 'utf8').toString('base64');
  await installJsZipMock(page);
  await page.addInitScript((b64) => { window.__fakeZipFiles = { 'normdata.txt': b64 }; }, sampleBase64);
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: seedPatients || [],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-settings').classList.add('active');
    openMigrationImportModal();
  });
  await page.setInputFiles('#migrationZipInput', { name: 'export.zip', mimeType: 'application/zip', buffer: Buffer.from('dummy') });
  await page.waitForFunction(() => document.getElementById('migrationZipStatus').textContent.includes('Format erkannt'));
}

test('confirming the import creates a new patient with the mapped Stammdaten fields', async ({ page }) => {
  const sampleText =
    ends1Line(1, 'FNM', 'Mustermann') +
    ends1Line(1, 'VNM', 'Max') +
    ends1Line(1, 'GBD', '15031980') +
    ends1Line(1, 'STR', 'Hauptstraße 5') +
    ends1Line(1, 'PLZ', '1010') +
    ends1Line(1, 'ORT', 'Wien') +
    ends1Line(1, 'TL1', '+43 664 1112233') +
    ends1Line(1, 'MAL', 'max@example.at') +
    ends1Line(1, 'VNR', '1234150380') +
    ends1Line(1, 'ALL', 'Penizillin') +
    ends1Line(1, 'DDG', 'Hypertonie') +
    ends1Line(1, 'XYZ', 'unmapped-value');
  await setupAdmin(page, sampleText, []);

  await page.evaluate(() => confirmMigrationImport());
  await page.waitForFunction(() => document.getElementById('migrationResultsArea').style.display === 'block');

  const summary = await page.locator('#migrationResultSummary').textContent();
  expect(summary).toContain('1 neue(r) Patient(en) angelegt');

  const patient = await page.evaluate(() => window.__store.patients.find(p => p.full_name === 'Max Mustermann'));
  expect(patient, 'the patient must have been created').toBeTruthy();
  expect(patient.dob).toBe('1980-03-15');
  expect(patient.adresse).toBe('Hauptstraße 5, 1010 Wien');
  expect(patient.tel).toBe('+43 664 1112233');
  expect(patient.email).toBe('max@example.at');
  expect(patient.svnr).toBe('1234150380');
  expect(patient.allergie).toBe('Penizillin');
  expect(patient.diagnosen).toBe('Hypertonie');
  expect(patient.legacy_history).toContain('XYZ=unmapped-value');
});

test('a patient already matched by SVNr is updated, not duplicated', async ({ page }) => {
  const sampleText =
    ends1Line(1, 'FNM', 'Musterfrau') +
    ends1Line(1, 'VNM', 'Erika') +
    ends1Line(1, 'GBD', '15031980') +
    ends1Line(1, 'VNR', '1234150380') +
    ends1Line(1, 'TL1', '+43 664 9998877');
  await setupAdmin(page, sampleText, [
    { id: 'existing-p1', username: 'erika.musterfrau', full_name: 'Erika Musterfrau', name: 'Erika', svnr: '1234150380', dob: '1980-03-15', join_status: 'approved' },
  ]);

  await page.evaluate(() => confirmMigrationImport());
  await page.waitForFunction(() => document.getElementById('migrationResultsArea').style.display === 'block');

  const summary = await page.locator('#migrationResultSummary').textContent();
  expect(summary).toContain('bereits bestehende(r) Patient(en) aktualisiert');

  const result = await page.evaluate(() => ({
    matches: window.__store.patients.filter(p => p.svnr === '1234150380'),
  }));
  expect(result.matches, 'must still be exactly one patient row, not a duplicate').toHaveLength(1);
  expect(result.matches[0].id).toBe('existing-p1');
  expect(result.matches[0].tel).toBe('+43 664 9998877');
});

test('a row missing Vor-/Nachname is skipped, not imported as a broken patient', async ({ page }) => {
  const sampleText =
    ends1Line(1, 'GBD', '15031980') +
    ends1Line(1, 'VNR', '1234150380') +
    ends1Line(2, 'FNM', 'Huber') +
    ends1Line(2, 'VNM', 'Anna') +
    ends1Line(2, 'GBD', '01011990');
  await setupAdmin(page, sampleText, []);

  await page.evaluate(() => confirmMigrationImport());
  await page.waitForFunction(() => document.getElementById('migrationResultsArea').style.display === 'block');

  const summary = await page.locator('#migrationResultSummary').textContent();
  expect(summary).toContain('1 neue(r) Patient(en) angelegt');
  expect(summary).toContain('1 Zeile(n) übersprungen');

  const patients = await page.evaluate(() => window.__store.patients);
  expect(patients).toHaveLength(1);
  expect(patients[0].full_name).toBe('Anna Huber');
});
