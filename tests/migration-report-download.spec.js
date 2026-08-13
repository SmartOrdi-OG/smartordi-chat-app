// Regression test for Phase 7 of the Praxisdaten-Migration feature: the
// downloadable CSV migration report (doctor.html's downloadMigrationReport())
// generated after confirmMigrationImport() finishes -- a permanent record of
// what an import did, since the on-screen summary/table disappears the
// moment the modal is closed. Reuses the same URL.createObjectURL
// interception pattern tests/csv-export.spec.js already established for
// exportPatientCsv().
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsZipMock } = require('./helpers/jszipStub');

function ends1LineDated(patientNr, block, field, date, time, value) {
  return String(patientNr).padStart(10, '0') + '#' + block + field + date + time + value + '\r\n';
}
function ends1Line(patientNr, field, value) {
  return String(patientNr).padStart(10, '0') + '#P' + field + '00000000' + '0000' + value + '\r\n';
}

test('downloadMigrationReport() produces a CSV with overall totals and a correct per-patient breakdown', async ({ page }) => {
  const text =
    ends1Line(1, 'FNM', 'Mustermann') + ends1Line(1, 'VNM', 'Max') +
    ends1LineDated(1, 'D', 'TXT', '10012020', '1000', 'Diabetes mellitus') +
    ends1LineDated(1, 'V', 'TXT', '01022021', '0900', 'Ibuprofen 400mg') +
    // A row with no Vorname -- must be counted as skipped, not appear in
    // the per-patient table.
    ends1Line(2, 'FNM', 'Ohne Vorname');
  const sampleBase64 = Buffer.from(text, 'utf8').toString('base64');

  await installJsZipMock(page);
  await page.addInitScript((b64) => { window.__fakeZipFiles = { 'normdata.txt': b64 }; }, sampleBase64);
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [],
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
  await page.evaluate(() => confirmMigrationImport());
  await page.waitForFunction(() => document.getElementById('migrationResultsArea').style.display === 'block');

  const csvText = await page.evaluate(async () => {
    let captured;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (blob) => { captured = blob; return 'blob:stub'; };
    const origRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = () => {};
    downloadMigrationReport();
    URL.createObjectURL = orig;
    URL.revokeObjectURL = origRevoke;
    return await captured.text();
  });

  expect(csvText).toContain('Migrationsbericht -- Normdatensatz (ENDS 1) Import');
  expect(csvText).toContain('normdata.txt');
  expect(csvText).toContain('Neue Patienten,1');
  expect(csvText).toContain('Übersprungene Zeilen (Vor-/Nachname fehlte),1');
  expect(csvText).toContain('Diagnosen in Verlauf übernommen,1');
  expect(csvText).toContain('Verordnungen in Rezepte übernommen,1');

  const rows = csvText.split('\n');
  const patientRow = rows.find(r => r.startsWith('Max Mustermann,'));
  expect(patientRow, 'the per-patient row must exist').toBeTruthy();
  const cells = patientRow.split(',');
  expect(cells[1]).toBe('Neu angelegt');
  expect(cells[2]).toBe('max.mustermann');
  expect(cells[3]).toBe('1'); // Diagnosen
  expect(cells[4]).toBe('1'); // Verordnungen
  expect(cells[5]).toBe('0'); // Laborbefunde
  expect(cells[6]).toBe('0'); // Befunde

  // The skipped row (no Vorname) must never appear as a patient row.
  expect(csvText).not.toContain('Ohne Vorname,');
});
