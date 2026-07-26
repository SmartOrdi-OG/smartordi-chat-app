// Regression test for secretary.html's bulk document import (ZIP + manifest
// CSV -> patient_documents): distinct from the patient CSV import above --
// this never creates a patient account, it only attaches files to patients
// that already exist, matched by SVNr or exact Vor-/Nachname.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsZipMock } = require('./helpers/jszipStub');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [
      { id: 'p1', username: 'julia.fuerst', full_name: 'Julia Fürst', name: 'Julia', versicherung: 'ÖGK', svnr: '7777050590', dob: '1990-05-05', join_status: 'approved' },
      { id: 'p2', username: 'max.novak', full_name: 'Max Novak', name: 'Max', versicherung: 'BVAEB', svnr: '1122334455', dob: '1980-02-02', join_status: 'approved' },
    ],
  };
}

test('uploads a real ZIP file via JSZip and matches the patient by SVNr, tolerating a ZIP subfolder path', async ({ page }) => {
  await installJsZipMock(page);
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  // The manifest only ever lists "befund_fuerst.pdf", not the ZIP's actual
  // internal path -- loadZipFileEntries() must still find it via its
  // basename fallback.
  await page.addInitScript(() => {
    window.__fakeZipFiles = { 'archive/befund_fuerst.pdf': 'ZmFrZS1wZGYtY29udGVudA==' };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);

  await page.evaluate(() => { openDocImportModal(); });
  await page.setInputFiles('#docImportZipInput', { name: 'export.zip', mimeType: 'application/zip', buffer: Buffer.from('dummy zip bytes') });
  await page.waitForFunction(() => document.getElementById('docImportZipStatus').textContent.includes('✓'));

  const zipStatus = await page.locator('#docImportZipStatus').textContent();
  expect(zipStatus).toContain('1 Datei(en)');

  const csv = 'Dateiname,SV-Nummer,Titel,Kategorie\nbefund_fuerst.pdf,7777 050590,Laborbefund,befund';
  const result = await page.evaluate(async (csvText) => {
    await patientsReady;
    document.getElementById('docImportCsvText').value = csvText;
    proceedToDocMapping();
    await confirmDocImport();
    return {
      docs: window.__store.patient_documents,
      summary: document.getElementById('docImportResultSummary').textContent,
    };
  }, csv);

  expect(result.docs).toHaveLength(1);
  expect(result.docs[0].patient_id).toBe('p1');
  expect(result.docs[0].category).toBe('befund');
  expect(result.docs[0].title).toBe('Laborbefund');
  expect(result.docs[0].filename).toBe('befund_fuerst.pdf');
  expect(result.docs[0].mime_type).toBe('application/pdf');
  expect(result.docs[0].file_data).toBe('ZmFrZS1wZGYtY29udGVudA==');
  expect(result.summary).toContain('1 Dokument(e) erfolgreich hochgeladen');
});

test('matches a patient by exact Vor-/Nachname when no SVNr is given', async ({ page }) => {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);

  const csv = 'Dateiname,Vorname,Nachname,Titel,Kategorie\nueberweisung_novak.pdf,Max,Novak,Überweisung Kardiologie,ueberweisung';
  const result = await page.evaluate(async (csvText) => {
    await patientsReady;
    // Shortcut for the ZIP side, mirroring how csv-import.spec.js sets
    // importCsvText directly instead of simulating a real file input --
    // real ZIP/JSZip parsing itself is covered by the test above.
    docImportZipEntries = { 'ueberweisung_novak.pdf': { dir: false, async: async () => 'ZmFrZS1wZGYtdHdv' } };
    document.getElementById('docImportCsvText').value = csvText;
    proceedToDocMapping();
    await confirmDocImport();
    return { docs: window.__store.patient_documents };
  }, csv);

  expect(result.docs).toHaveLength(1);
  expect(result.docs[0].patient_id).toBe('p2');
  expect(result.docs[0].category).toBe('ueberweisung');
});

test('flags an unmatched patient, a missing ZIP entry, an oversized file and a disallowed MIME type, without uploading them', async ({ page }) => {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);

  const csv = 'Dateiname,SV-Nummer\n'
    + 'valid.pdf,7777 050590\n'
    + 'missing.pdf,7777 050590\n'
    + 'toobig.pdf,7777 050590\n'
    + 'file.exe,7777 050590\n'
    + 'valid.pdf,0000000000';

  const result = await page.evaluate(async (csvText) => {
    await patientsReady;
    docImportZipEntries = {
      'valid.pdf': { dir: false, async: async () => 'c21hbGwtcGRmLWNvbnRlbnQ=' },
      // 11.5M base64 chars -> ~8.6MB decoded, over the 8MB cap.
      'toobig.pdf': { dir: false, async: async () => 'A'.repeat(11500000) },
      'file.exe': { dir: false, async: async () => 'ZXhl' },
    };
    document.getElementById('docImportCsvText').value = csvText;
    proceedToDocMapping();
    await confirmDocImport();
    return {
      docs: window.__store.patient_documents,
      rowsHtml: document.getElementById('docImportResultRows').innerHTML,
      summary: document.getElementById('docImportResultSummary').textContent,
    };
  }, csv);

  expect(result.docs, 'only the one genuinely valid row should have been uploaded').toHaveLength(1);
  expect(result.docs[0].filename).toBe('valid.pdf');
  expect(result.rowsHtml).toContain('Datei nicht im ZIP gefunden');
  expect(result.rowsHtml).toContain('Datei zu groß');
  expect(result.rowsHtml).toContain('Dateityp nicht erlaubt');
  expect(result.rowsHtml).toContain('Kein passender Patient gefunden');
  expect(result.summary).toContain('1 Dokument(e) erfolgreich hochgeladen');
  expect(result.summary).toContain('4 Zeile(n) fehlgeschlagen');
});
