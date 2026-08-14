// Regression test for ENDS 2 Phase 4 of the Praxisdaten-Migration feature:
// secondary documents referenced from a patient's own document INDEX.HTM
// besides the main NDS CDA (e.g. a standalone Laborbefund CDA like the real
// sample's LAB01.XML) are rendered to readable text and written into
// patient_documents (category 'befund') -- deliberately NOT field-parsed
// into patient_lab_results, since the real sample's standalone Laborbefund
// repeats values already captured from the main document's own
// Laborparameter section (see vendor/migration-normdatensatz2.js's
// ends2RenderCdaDocumentText() comment).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsZipMock } = require('./helpers/jszipStub');

const ROOT_INDEX_HTM = `<html><body><table>
<tr><th>Name</th><th>Vorname</th><th>Geburtsdatum</th><th>Dokumentenübersicht</th></tr>
<tr><td>Mustermann</td><td>Max</td><td>26.08.2001</td><td><a href="IHE_XDM/00000036/INDEX.HTM">Übersicht</a></td></tr>
</table></body></html>`;

// One main NDS row, one "Laborbefund" row pointing at a separate CDA doc.
const PATIENT_INDEX_HTM = `<html><body><table>
<tr><th>Dokumentart</th><th>Datum</th><th>Link</th><th>MIME-Type</th></tr>
<tr><td>NDS (CDA)</td><td>17.08.2019</td><td><a href="00000036.xml">00000036.xml</a></td><td>text/xml</td></tr>
<tr><td>Laborbefund</td><td>15.04.2018</td><td><a href="LAB01.XML">LAB01.XML</a></td><td>text/xml</td></tr>
</table></body></html>`;

// Points at a folder that has no LAB01.XML entry at all -- simulates a
// referenced-but-missing secondary document.
const PATIENT_INDEX_HTM_MISSING_FILE = PATIENT_INDEX_HTM;

function mainCdaDoc() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <id root="1.2.40.0.34.99.4613.3.1" extension="1234567.1" assigningAuthorityName="Amadeus Spital"/>
  <code code="EXNDS_Patientendaten" displayName="Datenbankexport EXNDS - Patientendaten" codeSystem="1.2.40.0.34.5.195"/>
  <title>Datenbankexport</title>
  <effectiveTime value="20190817121500+0100"/>
  <recordTarget>
    <patientRole>
      <id root="1.2.40.0.34.99.4613.3.2" extension="36" assigningAuthorityName="Amadeus Spital"/>
      <id root="1.2.40.0.10.1.4.3.1" extension="1234260826" assigningAuthorityName="Österreichische Sozialversicherung"/>
      <patient>
        <name><given>Maximilian</given><family>Mustermann</family></name>
        <administrativeGenderCode code="M"/>
        <birthTime value="20010826"/>
      </patient>
    </patientRole>
  </recordTarget>
</ClinicalDocument>`;
}

// Byte-faithful-in-spirit excerpt: same section templateId/table shape the
// real LAB01.XML sample uses for its "Hämatologie" speciality section
// (title + a Level 2 table), simplified to one section for the test.
function lab01Doc() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <title>Allgemeiner Laborbefund</title>
  <effectiveTime value="20180415130100+0200"/>
  <component><structuredBody>
    <component><section>
      <templateId root="1.3.6.1.4.1.19376.1.3.3.2.1"/>
      <code code="300" codeSystem="1.2.40.0.34.5.11" displayName="Hämatologie"/>
      <title>Hämatologie</title>
      <text>
        <paragraph styleCode="xELGA_h3">Blutbild</paragraph>
        <table>
          <thead><tr><th>Analyse</th><th>Ergebnis</th><th>Einheit</th><th>Referenzbereiche</th></tr></thead>
          <tbody>
            <tr><td>Erythrozyten</td><td>5.39</td><td>10^12/L</td><td>4.60-6.20</td></tr>
            <tr><td>Hämoglobin</td><td>16.0</td><td>g/dl</td><td>14.0-18.0</td></tr>
          </tbody>
        </table>
        <paragraph><content>Geringgradige Leukozytose, seit letzter Kontrolle gestiegen.</content></paragraph>
      </text>
    </section></component>
  </structuredBody></component>
</ClinicalDocument>`;
}

function b64(str) { return Buffer.from(str, 'utf8').toString('base64'); }

async function setupAndImport(page, fakeZipFiles) {
  await installJsZipMock(page);
  await page.addInitScript((files) => { window.__fakeZipFiles = files; }, fakeZipFiles);
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
  await page.waitForFunction(() => document.getElementById('migrationZipStatus').textContent.includes('ENDS 2'));
}

test('a found secondary document (e.g. a standalone Laborbefund CDA) is rendered to readable text and written as a Befund, not as lab-result rows', async ({ page }) => {
  await setupAndImport(page, {
    'INDEX.HTM': b64(ROOT_INDEX_HTM),
    'IHE_XDM/00000036/INDEX.HTM': b64(PATIENT_INDEX_HTM),
    'IHE_XDM/00000036/00000036.xml': b64(mainCdaDoc()),
    'IHE_XDM/00000036/LAB01.XML': b64(lab01Doc()),
  });

  const row = await page.locator('#migrationPreviewTableBody tr').first().textContent();
  expect(row).toContain('1 Befund(e)');
  expect(row).not.toContain('nicht in ZIP gefunden');

  await page.evaluate(() => confirmMigrationImport());
  await page.waitForFunction(() => document.getElementById('migrationResultsArea').style.display === 'block');

  const summary = await page.locator('#migrationResultSummary').textContent();
  expect(summary).toContain('1 Befund(e) in Dokumente übernommen');

  const state = await page.evaluate(() => ({
    docs: window.__store.patient_documents,
    labResults: window.__store.patient_lab_results,
  }));
  expect(state.docs).toHaveLength(1);
  expect(state.docs[0].category).toBe('befund');
  expect(state.docs[0].title).toBe('Laborbefund');
  expect(state.docs[0].body_text).toContain('Datum: 15.04.2018');
  expect(state.docs[0].body_text).toContain('Hämatologie');
  expect(state.docs[0].body_text).toContain('Erythrozyten');
  expect(state.docs[0].body_text).toContain('5.39');
  expect(state.docs[0].body_text).toContain('Geringgradige Leukozytose');

  // The whole point of rendering as text rather than field-parsing: no
  // lab-result rows are created from this document at all (avoids ever
  // double-counting a value already captured from the main CDA's own
  // Laborparameter section).
  expect(state.labResults).toHaveLength(0);
});

test('a secondary document referenced in the index but missing from the ZIP still creates a Befund noting it, instead of being silently dropped', async ({ page }) => {
  await setupAndImport(page, {
    'INDEX.HTM': b64(ROOT_INDEX_HTM),
    'IHE_XDM/00000036/INDEX.HTM': b64(PATIENT_INDEX_HTM_MISSING_FILE),
    'IHE_XDM/00000036/00000036.xml': b64(mainCdaDoc()),
    // LAB01.XML intentionally omitted from the ZIP.
  });

  const row = await page.locator('#migrationPreviewTableBody tr').first().textContent();
  expect(row).toContain('1 Befund(e)');
  expect(row).toContain('1 Datei(en) nicht in ZIP gefunden');

  await page.evaluate(() => confirmMigrationImport());
  await page.waitForFunction(() => document.getElementById('migrationResultsArea').style.display === 'block');

  const docs = await page.evaluate(() => window.__store.patient_documents);
  expect(docs).toHaveLength(1);
  expect(docs[0].category).toBe('befund');
  expect(docs[0].title).toBe('Laborbefund');
  expect(docs[0].body_text).toContain('nicht gefunden');
});
