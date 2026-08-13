// Regression test for Phase 1 of the Praxisdaten-Migration feature
// (vendor/migration-normdatensatz.js + doctor.html's "Praxisdaten
// importieren" card in Einstellungen): uploads a ZIP containing a real
// Legacy Export-Normdatensatz (ENDS 1, Ärztekammer spec Version IX) text
// file, and checks the resulting preview -- format detection, encoding,
// parsed Stammdaten (Familienname/Vorname/Geburtsdatum), and that other
// (not-yet-parsed) block types are still counted rather than silently
// dropped. These specific tests only exercise the preview step (never call
// confirmMigrationImport()), so nothing gets written to the database here --
// see tests/migration-normdatensatz-write.spec.js for the write step itself.
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
// Same header shape, but for a repeatable block (#D/#V/#L) where the
// date/time are the real event date, not zero-padding -- see
// vendor/migration-normdatensatz.js's ENDS1_REPEATABLE_BLOCKS comment.
function ends1LineDated(patientNr, block, field, date, time, value) {
  return String(patientNr).padStart(10, '0') + '#' + block + field + date + time + value + '\r\n';
}

const sampleText =
  ends1Line(1, 'FNM', 'Mustermann') +
  ends1Line(1, 'VNM', 'Max') +
  ends1Line(1, 'GBD', '15031980') +
  ends1Line(2, 'FNM', 'Musterfrau') +
  ends1Line(2, 'VNM', 'Erika') +
  ends1Line(2, 'GBD', '20071975') +
  // #D (Diagnosen) block lines for patient 1 -- Phase 3 parses these
  // field-by-field into a real diagnosen[] list, not just a raw count.
  ends1LineDated(1, 'D', 'TXT', '10012020', '1000', 'Diabetes mellitus') +
  ends1LineDated(1, 'D', 'TXT', '15032021', '1100', 'Hypertonie');
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
  // #D is now parsed field-by-field (Phase 3), so it must NOT show up in
  // the "not yet evaluated" line anymore.
  expect(summary).not.toContain('Diagnosen');

  const rows = page.locator('#migrationPreviewTableBody tr');
  await expect(rows).toHaveCount(2);
  const firstRow = await rows.nth(0).textContent();
  expect(firstRow).toContain('Mustermann');
  expect(firstRow).toContain('Max');
  expect(firstRow).toContain('15031980');
  expect(firstRow).toContain('2 Diagnose(n)');
  const secondRow = await rows.nth(1).textContent();
  expect(secondRow).toContain('Musterfrau');

  // Phase 1 never touches the database -- confirm nothing was written.
  const patientsWritten = await page.evaluate(() => window.__store.patients.length);
  expect(patientsWritten).toBe(0);
});

test('#V (Verordnungen) and #L (Laborbefunde) are also parsed field-by-field, and two entries sharing the same date+time are not merged', async ({ page }) => {
  const text =
    ends1Line(1, 'FNM', 'Gruber') +
    ends1Line(1, 'VNM', 'Tom') +
    ends1LineDated(1, 'V', 'TXT', '01022021', '0900', 'Ibuprofen 400mg') +
    ends1LineDated(1, 'V', 'MNG', '01022021', '0900', '1') +
    ends1LineDated(1, 'L', 'BEZ', '05012022', '0800', 'Blutbild') +
    ends1LineDated(1, 'L', 'WRT', '05012022', '0800', '120') +
    // Two DISTINCT diagnoses entered in the same visit (realistic case) --
    // same date+time, TXT repeats: must produce 2 entries, not 1 merged one.
    ends1LineDated(1, 'D', 'TXT', '10012020', '1000', 'Diabetes mellitus') +
    ends1LineDated(1, 'D', 'TXT', '10012020', '1000', 'Hypertonie');
  const base64 = Buffer.from(text, 'utf8').toString('base64');

  await installJsZipMock(page);
  await page.addInitScript((b64) => { window.__fakeZipFiles = { 'normdata.txt': b64 }; }, base64);
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
  await page.waitForFunction(() => document.getElementById('migrationZipStatus').textContent.includes('Format erkannt'));

  const row = await page.locator('#migrationPreviewTableBody tr').first().textContent();
  expect(row).toContain('2 Diagnose(n)');
  expect(row).toContain('1 Verordnung(en)');
  expect(row).toContain('1 Laborbefund(e)');

  const parsed = await page.evaluate(() => migrationParsedResult.patients[0]);
  expect(parsed.diagnosen).toHaveLength(2);
  expect(parsed.diagnosen.map(d => d.TXT).sort()).toEqual(['Diabetes mellitus', 'Hypertonie']);
  expect(parsed.verordnungen[0].TXT).toBe('Ibuprofen 400mg');
  expect(parsed.verordnungen[0].MNG).toBe('1');
  expect(parsed.laborbefunde[0].BEZ).toBe('Blutbild');
  expect(parsed.laborbefunde[0].WRT).toBe('120');
});

test('#F (Befunde) parses a multi-line text finding as one entry and resolves a document finding\'s file against the ZIP', async ({ page }) => {
  const text =
    ends1Line(1, 'FNM', 'Wagner') +
    ends1Line(1, 'VNM', 'Petra') +
    // A text finding (TBI=0) with 2 lines -- must stay ONE entry, not split
    // by TXT repeating.
    ends1LineDated(1, 'F', 'TBI', '10012020', '1000', '0') +
    ends1LineDated(1, 'F', 'ZLN', '10012020', '1000', '1') +
    ends1LineDated(1, 'F', 'TXT', '10012020', '1000', 'Erste Zeile.') +
    ends1LineDated(1, 'F', 'ZLN', '10012020', '1000', '2') +
    ends1LineDated(1, 'F', 'TXT', '10012020', '1000', 'Zweite Zeile.') +
    // A document finding (TBI=1) whose PFA basename matches a real file in
    // the ZIP -- must be resolved.
    ends1LineDated(1, 'F', 'TBI', '15032021', '1100', '1') +
    ends1LineDated(1, 'F', 'PFA', '15032021', '1100', 'e:/usr/dok/bef/bild.jpg') +
    // A second document finding whose PFA basename has NO match in the ZIP.
    ends1LineDated(1, 'F', 'TBI', '01062022', '0900', '1') +
    ends1LineDated(1, 'F', 'PFA', '01062022', '0900', 'c:/scan/missing.pdf');
  const base64 = Buffer.from(text, 'utf8').toString('base64');

  await installJsZipMock(page);
  await page.addInitScript((b64) => {
    window.__fakeZipFiles = { 'normdata.txt': b64, 'docs/BILD.JPG': btoa('dummy-image-bytes') };
  }, base64);
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
  await page.waitForFunction(() => document.getElementById('migrationZipStatus').textContent.includes('Format erkannt'));

  const row = await page.locator('#migrationPreviewTableBody tr').first().textContent();
  expect(row).toContain('3 Befund(e)');
  expect(row).toContain('1 Datei(en) nicht in ZIP gefunden');

  const summary = await page.locator('#migrationPreviewSummary').textContent();
  expect(summary).not.toContain('Befunde');

  const befunde = await page.evaluate(() => migrationParsedResult.patients[0].befunde);
  expect(befunde).toHaveLength(3);
  expect(befunde[0].TBI).toBe('0');
  expect(befunde[0].textLines.map(l => l.text)).toEqual(['Erste Zeile.', 'Zweite Zeile.']);
  expect(befunde[1].TBI).toBe('1');
  expect(befunde[1].fileFound).toBe(true);
  expect(befunde[1].matchedZipEntry).toBe('docs/BILD.JPG');
  expect(befunde[2].TBI).toBe('1');
  expect(befunde[2].fileFound).toBe(false);
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
