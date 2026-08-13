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

// Sections below are trimmed but otherwise byte-faithful excerpts from the
// real official ENDS 2 sample (github.com/TechnikumWienAcademy/cda-ends2,
// xdm-beispiel/IHE_XDM/00000036/00000036.xml) -- same table structure,
// column headers, and German field labels a real export would carry.
const SECTIONS_BODY = `
<component><structuredBody>
  <component><section>
    <templateId root="1.2.40.0.34.6.0.11.2.96"/>
    <code code="439401001" codeSystem="2.16.840.1.113883.6.96" displayName="Diagnosis"/>
    <title>Diagnose</title>
    <text>
      <table>
        <thead><tr><th>Zeitraum oder Zeitpunkt</th><th>Diagnosetext</th><th>Code [Codesystem]</th><th>Diagnoseart</th><th>Kürzel</th></tr></thead>
        <tbody>
          <tr><td>Seit Mai 1980</td><td>arterielle Hypertonie</td><td>I10.0 [ICD-10]</td><td>Dauerdiagnose</td><td>ahyp</td></tr>
          <tr><td>25.6.2010</td><td>Bandscheibenvorfall</td><td>M50 [ICD-10]</td><td>Überweisungsdiagnose</td><td>-</td></tr>
        </tbody>
      </table>
    </text>
  </section></component>
  <component><section>
    <templateId root="1.2.40.0.34.6.0.11.2.34"/>
    <code code="KARTEI_EINTRAGUNGEN" codeSystem="1.2.40.0.34.5.194" displayName="Karteineintragungen"/>
    <title>Karteineintragungen</title>
    <text>
      <table>
        <thead><tr><th>Zeilennummer</th><th>Text</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>GW 1/2004 ÜW</td></tr>
          <tr><td>2</td><td>Otitis</td></tr>
        </tbody>
      </table>
    </text>
    <entry typeCode="DRIV">
      <organizer classCode="BATTERY" moodCode="EVN">
        <templateId root="1.2.40.0.34.6.0.11.3.137"/>
        <code code="Karteieintragungen" codeSystem="1.2.40.0.34.5.195"/>
        <component typeCode="COMP">
          <observation classCode="OBS" moodCode="EVN">
            <templateId root="1.2.40.0.34.6.0.11.3.136"/>
            <effectiveTime><low value="20201006113228"/></effectiveTime>
            <value xsi:type="INT" value="1"/>
          </observation>
        </component>
        <component typeCode="COMP">
          <observation classCode="OBS" moodCode="EVN">
            <templateId root="1.2.40.0.34.6.0.11.3.136"/>
            <effectiveTime><low value="20201006113228"/></effectiveTime>
            <value xsi:type="INT" value="2"/>
          </observation>
        </component>
      </organizer>
    </entry>
  </section></component>
  <component><section>
    <templateId root="1.2.40.0.34.6.0.11.2.104"/>
    <code code="LabSpecContainer" codeSystem="1.2.40.0.34.5.194" displayName="Laboratory Speciality Container"/>
    <title>Laborparameter</title>
    <component><section>
      <templateId root="1.3.6.1.4.1.19376.1.3.3.2.1"/>
      <code code="300" codeSystem="1.2.40.0.34.5.11" displayName="Hämatologie"/>
      <title>Hämatologie</title>
      <text>
        <table>
          <thead><tr><th>Analyse</th><th>Ergebnis</th><th>Einheit</th><th>Referenzbereiche</th><th>Interpretation</th></tr></thead>
          <tbody>
            <tr><td>Leukozyten</td><td>26</td><td>10^9/L</td><td>4-10</td><td>+</td></tr>
            <tr><td>Thrombozyten</td><td>165</td><td>10^9/L</td><td>150-360</td><td/></tr>
          </tbody>
        </table>
      </text>
    </section></component>
  </section></component>
  <component><section>
    <templateId root="1.2.40.0.34.6.0.11.2.101"/>
    <code code="57828-6" displayName="Prescription list" codeSystem="2.16.840.1.113883.6.1"/>
    <title>Rezept</title>
    <text>
      <table>
        <thead><tr><th>Rezeptart</th><th>Gültig von</th><th>Gültig bis</th></tr></thead>
        <tbody><tr><td>Kassenrezept</td><td>2013-03-26</td><td>2014-04-27</td></tr></tbody>
      </table>
      <table ID="vpos-1">
        <tbody>
          <tr><td>Arznei Bezeichnung</td><td>Ciproxin 500mg Tabletten</td></tr>
          <tr><td>Arznei Pharmazentralnummer</td><td><content ID="prodcode-1">981417</content></td></tr>
          <tr><td>Arznei Wirkstoffname (ATC Code)</td><td>Ciprofloxacin (J01MA02)</td></tr>
          <tr><td>Einnahmedauer</td><td>2 Wochen</td></tr>
          <tr><td>Dosierung</td><td>2 - 0 - 1 - 0, täglich</td></tr>
          <tr><td>Anzahl der Packungen</td><td>1</td></tr>
        </tbody>
      </table>
    </text>
  </section></component>
</structuredBody></component>`;

function cdaDoc({ given = 'Maximilian', family = 'Mustermann', svnr = '1234260826', birth = '20010826', gender = 'M', withSections = false } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
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
  ${withSections ? SECTIONS_BODY : ''}
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

test('Diagnose/Karteineintragungen/Rezept/Laborparameter sections are parsed field-by-field from the CDA Level 2 tables', async ({ page }) => {
  await setupModal(page, {
    'INDEX.HTM': b64(ROOT_INDEX_HTM),
    'IHE_XDM/00000036/INDEX.HTM': b64(PATIENT_INDEX_HTM),
    'IHE_XDM/00000036/00000036.xml': b64(cdaDoc({ withSections: true })),
  });
  await page.waitForFunction(() => document.getElementById('migrationZipStatus').textContent.includes('ENDS 2'));

  const patient = await page.evaluate(() => migrationParsedResult.patients[0]);

  expect(patient.diagnosen).toHaveLength(2);
  expect(patient.diagnosen[0]).toMatchObject({ zeitraum: 'Seit Mai 1980', text: 'arterielle Hypertonie', code: 'I10.0 [ICD-10]', art: 'Dauerdiagnose' });
  expect(patient.diagnosen[1]).toMatchObject({ text: 'Bandscheibenvorfall', code: 'M50 [ICD-10]', art: 'Überweisungsdiagnose' });

  expect(patient.karteineintragungen).toHaveLength(2);
  expect(patient.karteineintragungen[0]).toMatchObject({ nr: '1', text: 'GW 1/2004 ÜW', datum: '06.10.2020' });
  expect(patient.karteineintragungen[1]).toMatchObject({ nr: '2', text: 'Otitis', datum: '06.10.2020' });

  expect(patient.verordnungen).toHaveLength(1);
  expect(patient.verordnungen[0]).toMatchObject({
    bezeichnung: 'Ciproxin 500mg Tabletten',
    dosierung: '2 - 0 - 1 - 0, täglich',
    packungen: '1',
    pzn: '981417',
    wirkstoff: 'Ciprofloxacin (J01MA02)',
    dauer: '2 Wochen',
    datum: '2013-03-26',
  });

  expect(patient.laborbefunde).toHaveLength(2);
  expect(patient.laborbefunde[0]).toMatchObject({ bezeichnung: 'Leukozyten', ergebnis: '26', einheit: '10^9/L', referenz: '4-10', gruppe: 'Hämatologie' });
  expect(patient.laborbefunde[1]).toMatchObject({ bezeichnung: 'Thrombozyten', ergebnis: '165', einheit: '10^9/L', referenz: '150-360' });

  const summary = await page.locator('#migrationPreviewTableBody tr').first().textContent();
  expect(summary).toContain('2 Diagnose(n)');
  expect(summary).toContain('2 Karteineintragung(en)');
  expect(summary).toContain('1 Verordnung(en)');
  expect(summary).toContain('2 Laborbefund(e)');
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
