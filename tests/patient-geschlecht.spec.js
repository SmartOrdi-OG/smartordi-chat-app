// Real user request (2026-08-16, supabase/phase72_patient_geschlecht.sql):
// a real gender field on patients/patient_join_requests, driving
// patient.html's symptom-picker body figure auto-selection (covered
// separately in tests/patient-symptom-body-figures.spec.js). This file
// covers every WRITE path that can now set it: patient-login.html
// self-registration, secretary.html's "+ Neuer Patient" and "Patient
// bearbeiten", the join-request approval flow, CSV import, and the ENDS
// Normdatensatz import (ENDS 2's confirmed HL7 gender code auto-maps;
// ENDS 1's unconfirmed numeric code deliberately does NOT, see doctor.
// html's import mapping's own comment).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsZipMock } = require('./helpers/jszipStub');

function staffSeed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
  };
}
function staffSession() {
  sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
  localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
}

test('secretary.html: "+ Neuer Patient" saves the selected Geschlecht', async ({ page }) => {
  await installMockSupabase(page, staffSeed(), staffSession);
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    openNewPatientModal();
    document.getElementById('npVorname').value = 'Tom';
    document.getElementById('npNachname').value = 'Huber';
    document.getElementById('npAdresse').value = 'Teststr. 1, 1010 Wien';
    document.getElementById('npGeburtsdatum').value = '2018-01-01';
    document.getElementById('npTelefon').value = '+43 1 2345678';
    document.getElementById('npGeschlecht').value = 'm';
    await confirmNewPatient();
    await new Promise(r => setTimeout(r, 100));
    return window.__store.patients.find(p => p.full_name === 'Tom Huber');
  });
  expect(result).toBeTruthy();
  expect(result.geschlecht).toBe('m');
});

test('secretary.html: "+ Neuer Patient" leaves Geschlecht null when left at "Keine Angabe"', async ({ page }) => {
  await installMockSupabase(page, staffSeed(), staffSession);
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    openNewPatientModal();
    document.getElementById('npVorname').value = 'Petra';
    document.getElementById('npNachname').value = 'Novak';
    document.getElementById('npAdresse').value = 'Teststr. 1, 1010 Wien';
    document.getElementById('npGeburtsdatum').value = '1990-01-01';
    document.getElementById('npTelefon').value = '+43 1 2345678';
    // npGeschlecht deliberately left untouched (defaults to "").
    await confirmNewPatient();
    await new Promise(r => setTimeout(r, 100));
    return window.__store.patients.find(p => p.full_name === 'Petra Novak');
  });
  expect(result).toBeTruthy();
  expect(result.geschlecht).toBeFalsy();
});

async function gotoFreshRegistration(page) {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html') + '?patient-register=1');
  await page.waitForTimeout(800);
}

test('patient-login.html: self-registration carries the chosen Geschlecht through to the submitted request', async ({ page }) => {
  await gotoFreshRegistration(page);
  await page.evaluate(async () => {
    document.getElementById('reqVorname').value = 'Max';
    document.getElementById('reqNachname').value = 'Mustermann';
    document.getElementById('reqDob').value = '1985-06-15';
    document.getElementById('reqTel').value = '+43 1 9998888';
    document.getElementById('reqAdresse').value = 'Teststr. 1, 1010 Wien';
    document.getElementById('reqSvnr').value = '1234010180';
    document.getElementById('reqGeschlecht').value = 'w';
    document.getElementById('reqUsername').value = 'maxmustermann-ges1';
    document.getElementById('reqPassword').value = 'geheim123';
    document.getElementById('reqConfirmPw').value = 'geheim123';
    document.getElementById('reqAgb').checked = true;
    await submitJoinRequest();
  });
  const requests = await page.evaluate(() => window.__store.patient_join_requests);
  expect(requests).toHaveLength(1);
  expect(requests[0].geschlecht).toBe('w');
});

test('patient-login.html: self-registration submits null (not empty string) when Geschlecht is left at "Keine Angabe"', async ({ page }) => {
  await gotoFreshRegistration(page);
  await page.evaluate(async () => {
    document.getElementById('reqVorname').value = 'Lea';
    document.getElementById('reqNachname').value = 'Berger';
    document.getElementById('reqDob').value = '1992-02-02';
    document.getElementById('reqTel').value = '+43 1 1112222';
    document.getElementById('reqAdresse').value = 'Teststr. 2, 1010 Wien';
    document.getElementById('reqSvnr').value = '1234020280';
    // reqGeschlecht deliberately left untouched.
    document.getElementById('reqUsername').value = 'leaberger-ges2';
    document.getElementById('reqPassword').value = 'geheim123';
    document.getElementById('reqConfirmPw').value = 'geheim123';
    document.getElementById('reqAgb').checked = true;
    await submitJoinRequest();
  });
  const requests = await page.evaluate(() => window.__store.patient_join_requests);
  expect(requests).toHaveLength(1);
  expect(requests[0].geschlecht).toBeFalsy();
});

test('secretary.html: approving a self-registration copies its Geschlecht onto the resulting patients row', async ({ page }) => {
  await installMockSupabase(page, {
    ...staffSeed(),
    patient_join_requests: [{
      id: 'jr1', username: 'maxmustermann-ges1', vorname: 'Max', nachname: 'Mustermann', full_name: 'Max Mustermann',
      dob: '1985-06-15', tel: '+43 1 9998888', adresse: 'Teststr. 1, 1010 Wien', svnr: '1234010180',
      geschlecht: 'w', pw_hash: 'h1', status: 'pending', submitted_at: '2026-08-01T10:00:00Z',
    }],
  }, staffSession);
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  const approved = await page.evaluate(async () => {
    await approveJoinRequest('maxmustermann-ges1');
    await new Promise(r => setTimeout(r, 200));
    return window.__store.patients.find(p => p.username === 'maxmustermann-ges1');
  });
  expect(approved).toBeTruthy();
  expect(approved.geschlecht).toBe('w');
});

test('secretary.html: "Patient bearbeiten" can set/correct Geschlecht on an existing patient', async ({ page }) => {
  await installMockSupabase(page, {
    ...staffSeed(),
    patients: [{ id: 'existing-p1', username: 'anna.huber', full_name: 'Anna Huber', name: 'Anna', dob: '1990-01-01', join_status: 'approved' }],
  }, staffSession);
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    await patientsReady;
    openPatientDetail('Anna Huber', '#000', 'ÖGK', 'Addr', '+43 1', '', '1990-01-01', false, null);
    document.getElementById('pdGeschlecht').value = 'w';
    await savePatientEdit();
    await new Promise(r => setTimeout(r, 100));
    return window.__store.patients.find(p => p.username === 'anna.huber');
  });
  expect(result.geschlecht).toBe('w');
});

test('secretary.html: CSV import maps a recognized "Geschlecht" column and leaves an unrecognized value unset', async ({ page }) => {
  await installMockSupabase(page, staffSeed(), staffSession);
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);

  const csv = 'Vorname,Nachname,Geburtsdatum,Geschlecht\n'
    + 'Anna,Fischer,05.06.1990,weiblich\n'
    + 'Ben,Klein,01.01.1988,unbekannt-code-42';

  const result = await page.evaluate(async (csvText) => {
    await patientsReady;
    document.getElementById('importCsvText').value = csvText;
    proceedToMapping();
    await confirmImport();
    await new Promise(r => setTimeout(r, 100));
    return window.__store.patients;
  }, csv);

  const anna = result.find(p => p.full_name === 'Anna Fischer');
  const ben = result.find(p => p.full_name === 'Ben Klein');
  expect(anna, 'a recognized synonym ("weiblich") is mapped to w').toBeTruthy();
  expect(anna.geschlecht).toBe('w');
  expect(ben, 'an unrecognized value is never guessed -- left unset').toBeTruthy();
  expect(ben.geschlecht).toBeFalsy();
});

// ── ENDS Normdatensatz import ──

function ends1Line(patientNr, field, value) {
  return String(patientNr).padStart(10, '0') + '#P' + field + '00000000' + '0000' + value + '\r\n';
}

test('doctor.html: an ENDS 1 import preserves the raw GES code as text (never guesses a mapping) and leaves geschlecht unset', async ({ page }) => {
  const sampleText =
    ends1Line(1, 'FNM', 'Mustermann') +
    ends1Line(1, 'VNM', 'Max') +
    ends1Line(1, 'GBD', '15031980') +
    ends1Line(1, 'GES', '1');
  const sampleBase64 = Buffer.from(sampleText, 'utf8').toString('base64');
  await installJsZipMock(page);
  await page.addInitScript((b64) => { window.__fakeZipFiles = { 'normdata.txt': b64 }; }, sampleBase64);
  await installMockSupabase(page, staffSeed(), () => {
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

  const patient = await page.evaluate(() => window.__store.patients.find(p => p.full_name === 'Max Mustermann'));
  expect(patient).toBeTruthy();
  expect(patient.geschlecht, 'ENDS1 GES has no confirmed encoding table -- never auto-mapped').toBeFalsy();
  expect(patient.legacy_history, 'the raw code must still be preserved, never silently dropped').toContain('Geschlecht');
  expect(patient.legacy_history).toContain('Altsystem-Code');
  expect(patient.legacy_history).toContain(': 1');
});

test('doctor.html: an ENDS 2 import auto-maps the confirmed HL7 administrativeGenderCode', async ({ page }) => {
  const ROOT_INDEX_HTM = `<html><body><table>
<tr><th>Name</th><th>Vorname</th><th>Geburtsdatum</th><th>Dokumentenübersicht</th></tr>
<tr><td>Mustermann</td><td>Maximilian</td><td>26.08.2001</td><td><a href="IHE_XDM/00000036/INDEX.HTM">Übersicht</a></td></tr>
</table></body></html>`;
  const PATIENT_INDEX_HTM = `<html><body><table>
<tr><th>Dokumentart</th><th>Datum</th><th>Link</th><th>MIME-Type</th></tr>
<tr><td>NDS (CDA)</td><td>17.08.2019</td><td><a href="00000036.xml">00000036.xml</a></td><td>text/xml</td></tr>
</table></body></html>`;
  const cdaDoc = `<?xml version="1.0" encoding="UTF-8"?>
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
  <component><structuredBody></structuredBody></component>
</ClinicalDocument>`;
  function b64(str) { return Buffer.from(str, 'utf8').toString('base64'); }

  await installJsZipMock(page);
  await page.addInitScript((files) => { window.__fakeZipFiles = files; }, {
    'INDEX.HTM': b64(ROOT_INDEX_HTM),
    'IHE_XDM/00000036/INDEX.HTM': b64(PATIENT_INDEX_HTM),
    'IHE_XDM/00000036/00000036.xml': b64(cdaDoc),
  });
  await installMockSupabase(page, staffSeed(), () => {
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

  const patient = await page.evaluate(() => window.__store.patients.find(p => p.full_name === 'Maximilian Mustermann'));
  expect(patient).toBeTruthy();
  expect(patient.geschlecht).toBe('m');
});
