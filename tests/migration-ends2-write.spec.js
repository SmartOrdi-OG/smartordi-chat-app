// Regression test for ENDS 2 Phase 3 of the Praxisdaten-Migration feature:
// writing the already-parsed Diagnose/Karteineintragungen/Verordnungen/
// Laborparameter entries (ENDS 2 Phase 2) into Verlauf/Rezepte/Laborwerte
// once a patient is created/matched (doctor.html's confirmMigrationImport(),
// see importMigrationSubRecords() and its four ENDS-2-specific helpers).
// Mirrors tests/migration-normdatensatz-subrecords.spec.js's ENDS 1 pattern.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsZipMock } = require('./helpers/jszipStub');

const ROOT_INDEX_HTM = `<html><body><table>
<tr><th>Name</th><th>Vorname</th><th>Geburtsdatum</th><th>Dokumentenübersicht</th></tr>
<tr><td>Mustermann</td><td>Max</td><td>26.08.2001</td><td><a href="IHE_XDM/00000036/INDEX.HTM">Übersicht</a></td></tr>
</table></body></html>`;

const PATIENT_INDEX_HTM = `<html><body><table>
<tr><th>Dokumentart</th><th>Datum</th><th>Link</th><th>MIME-Type</th></tr>
<tr><td>NDS (CDA)</td><td>17.08.2019</td><td><a href="00000036.xml">00000036.xml</a></td><td>text/xml</td></tr>
</table></body></html>`;

// Same byte-faithful excerpt from the real official sample as ENDS 2 Phase
// 2's test fixture (tests/migration-ends2-stammdaten.spec.js) -- one
// unambiguous-date Diagnose ("25.6.2010"), one ambiguous one ("Seit Mai
// 1980", must be skipped rather than guessed), two Karteineintragungen,
// one Verordnung, two Laborbefunde.
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

function cdaDoc({ given = 'Maximilian', family = 'Mustermann', svnr = '1234260826', birth = '20010826', gender = 'M' } = {}) {
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
      <telecom use="H" value="mailto:max@example.at"/>
      <patient>
        <name><given>${given}</given><family>${family}</family></name>
        <administrativeGenderCode code="${gender}"/>
        <birthTime value="${birth}"/>
      </patient>
    </patientRole>
  </recordTarget>
  ${SECTIONS_BODY}
</ClinicalDocument>`;
}

function b64(str) { return Buffer.from(str, 'utf8').toString('base64'); }

async function setupAndImport(page, fakeZipFiles, seedPatients) {
  await installJsZipMock(page);
  await page.addInitScript((files) => { window.__fakeZipFiles = files; }, fakeZipFiles);
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
  await page.waitForFunction(() => document.getElementById('migrationZipStatus').textContent.includes('ENDS 2'));
  await page.evaluate(() => confirmMigrationImport());
  await page.waitForFunction(() => document.getElementById('migrationResultsArea').style.display === 'block');
}

test('an ENDS 2 import writes Diagnose (unambiguous date only) + Karteineintragungen into Verlauf, Verordnung into Rezepte, Laborparameter into Laborwerte', async ({ page }) => {
  await setupAndImport(page, {
    'INDEX.HTM': b64(ROOT_INDEX_HTM),
    'IHE_XDM/00000036/INDEX.HTM': b64(PATIENT_INDEX_HTM),
    'IHE_XDM/00000036/00000036.xml': b64(cdaDoc()),
  });

  const state = await page.evaluate(() => {
    const patient = window.__store.patients.find(p => p.full_name === 'Maximilian Mustermann');
    return {
      patientId: patient && patient.id,
      patient,
      visits: window.__store.patient_visits,
      rezepte: window.__store.patient_rezepte,
      labResults: window.__store.patient_lab_results,
    };
  });
  expect(state.patientId).toBeTruthy();
  expect(state.patient.tel).toBe('0676.1234567');
  expect(state.patient.email).toBe('max@example.at');
  expect(state.patient.svnr).toBe('1234260826');

  // Diagnose: only the unambiguous "25.6.2010" row is written -- "Seit Mai
  // 1980" has no fully-specified date and must be skipped, not guessed.
  // Karteineintragungen: both rows are written (their date comes from a
  // real, structured Level 3 <observation>, not free text).
  expect(state.visits).toHaveLength(3);
  expect(state.visits.every(v => v.patient_id === state.patientId)).toBe(true);

  const diagnoseVisit = state.visits.find(v => v.visit_type === 'Diagnose (ENDS 2-Import)');
  expect(diagnoseVisit).toBeTruthy();
  expect(diagnoseVisit.visit_date).toBe('2010-06-25');
  expect(diagnoseVisit.diagnose).toBe('Bandscheibenvorfall');
  expect(diagnoseVisit.notes).toContain('M50 [ICD-10]');
  expect(diagnoseVisit.notes).toContain('Überweisungsdiagnose');

  const karteiVisits = state.visits.filter(v => v.visit_type === 'Karteieintrag (ENDS 2-Import)');
  expect(karteiVisits).toHaveLength(2);
  expect(karteiVisits.every(v => v.visit_date === '2020-10-06')).toBe(true);
  expect(karteiVisits.map(v => v.diagnose).sort()).toEqual(['GW 1/2004 ÜW', 'Otitis']);

  expect(state.rezepte).toHaveLength(1);
  expect(state.rezepte[0].patient_id).toBe(state.patientId);
  expect(state.rezepte[0].med1).toBe('Ciproxin 500mg Tabletten');
  expect(state.rezepte[0].packungen1).toBe('1');
  expect(state.rezepte[0].dosierung1).toBe('2 - 0 - 1 - 0, täglich');
  expect(state.rezepte[0].datum).toBe('2013-03-26');
  expect(state.rezepte[0].notizen).toContain('PZN: 981417');
  expect(state.rezepte[0].notizen).toContain('Ciprofloxacin (J01MA02)');

  expect(state.labResults).toHaveLength(2);
  expect(state.labResults.every(l => l.patient_id === state.patientId)).toBe(true);
  expect(state.labResults.every(l => l.quelle === 'Normdatensatz-Import (ENDS 2)')).toBe(true);
  const leuko = state.labResults.find(l => l.bezeichnung === 'Leukozyten');
  expect(leuko.wert).toBe(26);
  expect(leuko.gruppe).toBe('Hämatologie');

  // Summary line: Diagnose + Karteineintragungen counts fold into the same
  // "Diagnose(n) in Verlauf übernommen" bucket rather than a separate one.
  const summary = await page.locator('#migrationResultSummary').textContent();
  expect(summary).toContain('3 Diagnose(n) in Verlauf übernommen');
  expect(summary).toContain('1 Verordnung(en) in Rezepte übernommen');
  expect(summary).toContain('2 Laborbefund(e) übernommen');
});

test('an ENDS 2 patient with an implausible "Gültig von" table value gets a Rezept row without a bogus date', async ({ page }) => {
  const badDateSections = SECTIONS_BODY.replace('<td>2013-03-26</td>', '<td>irgendwann</td>');
  await setupAndImport(page, {
    'INDEX.HTM': b64(ROOT_INDEX_HTM),
    'IHE_XDM/00000036/INDEX.HTM': b64(PATIENT_INDEX_HTM),
    'IHE_XDM/00000036/00000036.xml': b64(`<?xml version="1.0" encoding="UTF-8"?>
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
  ${badDateSections}
</ClinicalDocument>`),
  });

  // createPatientRezept() defaults an omitted datum to today (same as the
  // ENDS 1 write path) -- the point here is that the implausible raw table
  // text ("irgendwann") never lands in a date column, not that the column
  // stays empty.
  const rezepte = await page.evaluate(() => window.__store.patient_rezepte);
  expect(rezepte).toHaveLength(1);
  expect(rezepte[0].datum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('sub-records are written for an already-existing (matched) ENDS 2 patient too, referencing the existing patient id', async ({ page }) => {
  await setupAndImport(page, {
    'INDEX.HTM': b64(ROOT_INDEX_HTM),
    'IHE_XDM/00000036/INDEX.HTM': b64(PATIENT_INDEX_HTM),
    'IHE_XDM/00000036/00000036.xml': b64(cdaDoc()),
  }, [
    { id: 'existing-p1', username: 'maximilian.mustermann', full_name: 'Maximilian Mustermann', name: 'Maximilian', svnr: '1234260826', dob: '2001-08-26', join_status: 'approved' },
  ]);

  const state = await page.evaluate(() => ({
    visits: window.__store.patient_visits,
    patients: window.__store.patients,
  }));
  expect(state.visits.length).toBeGreaterThan(0);
  expect(state.visits.every(v => v.patient_id === 'existing-p1')).toBe(true);
  expect(state.patients.filter(p => p.svnr === '1234260826')).toHaveLength(1);
});
