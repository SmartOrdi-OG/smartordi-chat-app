// Regression test for a real bug found via a user report (2026-07-30):
// CSV-imported vaccination history (parseImpfungenCell()) only ever had
// the free-text vaccine name from the old system's export -- never a
// vaccine_key, unlike doctor.html's manual Kartei entry (which picks from
// a dropdown and sets it correctly). dueVaccinationsForPatient() matches a
// given dose against VACCINE_SCHEDULE strictly by `key`, never by
// free-text name -- so an imported dose's vaccine_key staying null forever
// meant the dose could NEVER satisfy the schedule, and an already-given,
// already-recorded vaccination kept showing up as "überfällig" (overdue)
// on the dashboard regardless of what the CSV said. matchVaccineKey()
// fixes this by resolving the free-text name (or a known alias) to the
// correct internal key at import time.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function setupPage(page, extraSeed) {
  await installMockSupabase(page, Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'standard' }],
  }, extraSeed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);
}

test('matchVaccineKey() resolves common CSV vaccine names (and aliases) to the correct internal key', async ({ page }) => {
  await setupPage(page);
  const results = await page.evaluate(() => ({
    sechsfach: matchVaccineKey('6-fach'),
    fullName: matchVaccineKey('6-fach (Diphtherie-Tetanus-Pertussis-Hib-Polio-Hepatitis B)'),
    mmr: matchVaccineKey('MMR'),
    grippe: matchVaccineKey('Grippe'),
    windpocken: matchVaccineKey('Windpocken'),
    zecken: matchVaccineKey('Zecken-Impfung'),
    caseInsensitive: matchVaccineKey('pneumokokken'.toUpperCase()),
    unknown: matchVaccineKey('EineGanzUnbekannteImpfung'),
    empty: matchVaccineKey(''),
  }));
  expect(results.sechsfach).toBe('sechsfach');
  expect(results.fullName).toBe('sechsfach');
  expect(results.mmr).toBe('mmr');
  expect(results.grippe, 'Grippe is the common German name for Influenza').toBe('influenza');
  expect(results.windpocken, 'Windpocken is the common German name for Varizellen').toBe('varizellen');
  expect(results.zecken, 'Zecken-Impfung is the common name for FSME').toBe('fsme');
  expect(results.caseInsensitive).toBe('pneumokokken');
  expect(results.unknown, 'an unrecognized name must not crash or false-match').toBeNull();
  expect(results.empty).toBeNull();
});

test('CSV import for a NEW patient sets the resolved vaccine_key, not null', async ({ page }) => {
  await setupPage(page);
  const csv = 'Vorname,Nachname,Impfungen\n'
    + 'Alina,Saadat,"6-fach:15.03.2023;MMR:10.01.2024;Grippe:01.11.2025"';
  const result = await page.evaluate(async (csvText) => {
    await Promise.all([patientsReady, impfungenReady]);
    document.getElementById('importCsvText').value = csvText;
    proceedToMapping();
    await confirmImport();
    await new Promise(r => setTimeout(r, 150));
    return window.__store.patient_impfungen;
  }, csv);
  const byName = name => result.find(r => r.vaccine_name === name);
  expect(byName('6-fach').vaccine_key).toBe('sechsfach');
  expect(byName('MMR').vaccine_key).toBe('mmr');
  expect(byName('Grippe').vaccine_key).toBe('influenza');
});

test('CSV import for an EXISTING (SVNr-matched) patient also sets the resolved vaccine_key', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'existing-p1', username: 'josef.bauer', full_name: 'Josef Bauer', name: 'Josef', svnr: '4567180452', dob: '1952-04-18', join_status: 'approved' }],
  });
  const csv = 'Vorname,Nachname,SVNr,Impfungen\n'
    + 'Josef,Bauer,4567180452,"FSME:12.06.2022"';
  const result = await page.evaluate(async (csvText) => {
    await patientsReady;
    document.getElementById('importCsvText').value = csvText;
    proceedToMapping();
    await confirmImport();
    await new Promise(r => setTimeout(r, 150));
    return window.__store.patient_impfungen.filter(r => r.patient_id === 'existing-p1');
  }, csv);
  expect(result).toHaveLength(1);
  expect(result[0].vaccine_key).toBe('fsme');
});

test('end-to-end: an imported dose with the resolved key no longer shows as due/overdue', async ({ page }) => {
  await setupPage(page);
  // 6-fach's schedule is D1(minDay:90), D2(minDay:150), ... -- a child aged
  // ~100 days (past D1's minDay, not yet at D2's) whose D1 dose was already
  // given and imported must NOT appear in dueVaccinationsForPatient() once
  // the key resolves correctly, since D1 is the only dose due at this age.
  // dob is computed relative to "today" (not hardcoded) so this doesn't
  // depend on when the test happens to run.
  const csv = 'Vorname,Nachname,Geburtsdatum,Impfungen\n'
    + 'Test,Kind,{{DOB}},"6-fach:01.01.2020"';
  const result = await page.evaluate(async (csvTemplate) => {
    const dob = new Date(Date.now() - 100 * 86400000);
    const dobDE = String(dob.getDate()).padStart(2, '0') + '.' + String(dob.getMonth() + 1).padStart(2, '0') + '.' + dob.getFullYear();
    const csvText = csvTemplate.replace('{{DOB}}', dobDE);
    await Promise.all([patientsReady, impfungenReady]);
    document.getElementById('importCsvText').value = csvText;
    proceedToMapping();
    await confirmImport();
    await new Promise(r => setTimeout(r, 150));
    const patient = window.__store.patients.find(p => p.full_name === 'Test Kind');
    const impfungen = window.__store.patient_impfungen
      .filter(r => r.patient_id === patient.id)
      .map(r => ({ vaccineKey: r.vaccine_key, vaccineName: r.vaccine_name, datum: r.datum }));
    const due = dueVaccinationsForPatient('Test Kind', patient.dob, impfungen);
    return { due, vaccineKey: impfungen[0] && impfungen[0].vaccineKey };
  }, csv);
  expect(result.vaccineKey).toBe('sechsfach');
  expect(result.due.some(d => d.vaccine.startsWith('6-fach')), 'the already-given, correctly-keyed dose must not show as due').toBe(false);
});
