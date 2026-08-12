// Regression test for Phase 1 of the Praxisdaten-Migration feature
// (vendor/migration-normdatensatz.js + doctor.html's "Praxisdaten
// importieren" card in Einstellungen): uploads a ZIP containing a real
// Legacy Export-Normdatensatz (ENDS 1, Ärztekammer spec Version IX) text
// file, and checks the resulting preview -- format detection, encoding,
// parsed Stammdaten (Familienname/Vorname/Geburtsdatum), and that other
// (not-yet-parsed) block types are still counted rather than silently
// dropped. This phase never writes to the database -- see TODO.md.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsZipMock } = require('./helpers/jszipStub');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [],
  };
}

// Builds one ENDS1 line exactly per the official spec's 27-character
// header: 10-digit patient number + '#P' + 3-letter field code + 8-digit
// date (zero-padded for master data) + 4-digit time (zero-padded) + value.
function ends1Line(patientNr, field, value) {
  return String(patientNr).padStart(10, '0') + '#P' + field + '00000000' + '0000' + value + '\r\n';
}

const sampleText =
  ends1Line(1, 'FNM', 'Mustermann') +
  ends1Line(1, 'VNM', 'Max') +
  ends1Line(1, 'GBD', '15031980') +
  ends1Line(2, 'FNM', 'Musterfrau') +
  ends1Line(2, 'VNM', 'Erika') +
  ends1Line(2, 'GBD', '20071975') +
  // #D (Diagnosen) block lines for patient 1 -- not yet parsed field-by-field
  // in Phase 1, but must still be counted in the preview, not dropped.
  '0000000001#DTXT0000000000001100Diabetes mellitus\r\n' +
  '0000000001#DTXT0000000000001200Hypertonie\r\n';
const sampleBase64 = Buffer.from(sampleText, 'utf8').toString('base64');

async function setupAdmin(page) {
  await installJsZipMock(page);
  await page.addInitScript((b64) => {
    window.__fakeZipFiles = { 'normdata.txt': b64 };
  }, sampleBase64);
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-settings').classList.add('active');
  });
}

test('uploading a real Legacy Normdatensatz ZIP shows a correct patient preview without writing anything', async ({ page }) => {
  await setupAdmin(page);

  await page.evaluate(() => { openMigrationImportModal(); });
  await expect(page.locator('#migrationImportModal')).toHaveClass(/show/);

  await page.setInputFiles('#migrationZipInput', { name: 'export.zip', mimeType: 'application/zip', buffer: Buffer.from('dummy zip bytes') });
  await page.waitForFunction(() => document.getElementById('migrationZipStatus').textContent.includes('Format erkannt'));

  const status = await page.locator('#migrationZipStatus').textContent();
  expect(status).toContain('ENDS 1');
  expect(status).toContain('utf-8');

  const summary = await page.locator('#migrationPreviewSummary').textContent();
  expect(summary).toContain('2 Patient(en) gefunden');
  expect(summary).toContain('Diagnosen');

  const rows = page.locator('#migrationPreviewTableBody tr');
  await expect(rows).toHaveCount(2);
  const firstRow = await rows.nth(0).textContent();
  expect(firstRow).toContain('Mustermann');
  expect(firstRow).toContain('Max');
  expect(firstRow).toContain('15031980');
  const secondRow = await rows.nth(1).textContent();
  expect(secondRow).toContain('Musterfrau');

  // Phase 1 never touches the database -- confirm nothing was written.
  const patientsWritten = await page.evaluate(() => window.__store.patients.length);
  expect(patientsWritten).toBe(0);
});

test('a ZIP with no recognizable Normdatensatz content shows a clear "not detected" message', async ({ page }) => {
  await installJsZipMock(page);
  await page.addInitScript(() => {
    window.__fakeZipFiles = { 'irgendwas.txt': btoa('Das ist einfach nur ein normaler Text ohne Struktur.') };
  });
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-settings').classList.add('active');
    openMigrationImportModal();
  });

  await page.setInputFiles('#migrationZipInput', { name: 'export.zip', mimeType: 'application/zip', buffer: Buffer.from('dummy') });
  await page.waitForFunction(() => document.getElementById('migrationZipStatus').textContent.length > 0);

  const status = await page.locator('#migrationZipStatus').textContent();
  expect(status).toContain('Kein Export-Normdatensatz');
  await expect(page.locator('#migrationPreviewArea')).toBeHidden();
});

test('a non-admin cannot open the migration import modal', async ({ page }) => {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Angestellt', username: 'dr.angestellt', isAdmin: false }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-settings').classList.add('active');
    openMigrationImportModal();
  });
  await expect(page.locator('#migrationImportModal')).not.toHaveClass(/show/);
});
