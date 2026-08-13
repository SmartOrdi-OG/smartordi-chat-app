// Regression test for ENDS 2 Phase 1 of the Praxisdaten-Migration feature:
// detecting an ENDS 2 (CDA/XML, IHE XDM container) export and parsing just
// the patient Stammdaten for a read-only preview (vendor/
// migration-normdatensatz2.js's parseEnds2Zip()). Same house pattern as
// the ENDS 1 phase tests -- builds a fake ZIP via window.__fakeZipFiles and
// drives doctor.html's real migration-import modal end to end.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsZipMock } = require('./helpers/jszipStub');

// Mirrors the real structure verified against the official ENDS 2 sample
// (github.com/TechnikumWienAcademy/cda-ends2/xdm-beispiel): a root
// INDEX.HTM listing patients, each pointing at IHE_XDM/<id>/INDEX.HTM,
// which in turn points at that patient's main CDA document.
const ROOT_INDEX_HTM = `<html><body><table>
<tr><th>Name</th><th>Vorname</th><th>Geburtsdatum</th><th>Dokumentenübersicht</th></tr>
<tr><td>Mustermann</td><td>Max</td><td>26.08.2001</td><td><a href="IHE_XDM/00000036/INDEX.HTM">Übersicht</a></td></tr>
</table></body></html>`;

const PATIENT_INDEX_HTM = `<html><body><table>
<tr><th>Dokumentart</th><th>Datum</th><th>Link</th><th>MIME-Type</th></tr>
<tr><td>NDS (CDA)</td><td>17.08.2019</td><td><a href="00000036.xml">00000036.xml</a></td><td>text/xml</td></tr>
<tr><td>Laborbefund</td><td>15.04.2018</td><td><a href="LAB01.XML">LAB01.XML</a></td><td>text/xml</td></tr>
</table></body></html>`;

function cdaDoc({ given = 'Maximilian', family = 'Mustermann', svnr = '1234260826', birth = '20010826', gender = 'M' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <id root="1.2.40.0.34.99.4613.3.1" extension="1234567.1" assigningAuthorityName="Amadeus Spital"/>
  <code code="EXNDS_Patientendaten" displayName="Datenbankexport EXNDS - Patientendaten" codeSystem="1.2.40.0.34.5.195"/>
  <title>Datenbankexport</title>
  <effectiveTime value="20190817121500+0100"/>
  <recordTarget>
    <patientRole>
      <id root="1.2.40.0.34.99.4613.3.2" extension="36" assigningAuthorityName="Amadeus Spital"/>
      <id root="1.2.40.0.10.1.4.3.1" extension="${svnr}" assigningAuthorityName="Österreichische Sozialversicherung"/>
      <addr use="H">
        <streetAddressLine>Teststraße 1</streetAddressLine>
        <postalCode>1010</postalCode>
        <city>Wien</city>
        <country>AUT</country>
      </addr>
      <telecom use="H" value="tel:0676.1234567"/>
      <patient>
        <name><given>${given}</given><family>${family}</family></name>
        <administrativeGenderCode code="${gender}"/>
        <birthTime value="${birth}"/>
      </patient>
    </patientRole>
  </recordTarget>
</ClinicalDocument>`;
}

function b64(str) { return Buffer.from(str, 'utf8').toString('base64'); }

async function setupModal(page, fakeZipFiles) {
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
}

test('an ENDS 2 (CDA/XML, IHE XDM) export is detected and the patient Stammdaten previewed', async ({ page }) => {
  await setupModal(page, {
    'INDEX.HTM': b64(ROOT_INDEX_HTM),
    'IHE_XDM/00000036/INDEX.HTM': b64(PATIENT_INDEX_HTM),
    'IHE_XDM/00000036/00000036.xml': b64(cdaDoc()),
  });

  await page.waitForFunction(() => document.getElementById('migrationZipStatus').textContent.includes('ENDS 2'));

  const summary = await page.locator('#migrationPreviewSummary').textContent();
  expect(summary).toContain('1 Patient(en) gefunden');

  const row = await page.locator('#migrationPreviewTableBody tr').first().textContent();
  expect(row).toContain('Mustermann');
  expect(row).toContain('Maximilian');
  expect(row).toContain('26.08.2001');
});

test('a patient row whose per-patient INDEX.HTM link is broken is skipped, not shown blank', async ({ page }) => {
  await setupModal(page, {
    // Root index points at a patient folder that was never actually included.
    'INDEX.HTM': b64(ROOT_INDEX_HTM),
  });

  await page.waitForFunction(() => document.getElementById('migrationZipStatus').textContent.length > 0);
  const status = await page.locator('#migrationZipStatus').textContent();
  expect(status).toContain('Kein Export-Normdatensatz');
});

test('a ZIP with no IHE_XDM folder at all is not mistaken for ENDS 2', async ({ page }) => {
  await setupModal(page, {
    'INDEX.HTM': b64('<html><body>not an export</body></html>'),
    'random.txt': b64('irrelevant content'),
  });

  await page.waitForFunction(() => document.getElementById('migrationZipStatus').textContent.length > 0);
  const status = await page.locator('#migrationZipStatus').textContent();
  expect(status).toContain('Kein Export-Normdatensatz');
});
