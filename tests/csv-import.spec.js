// Regression test for secretary.html's patient CSV import: matches
// existing patients by SVNr/name+DOB instead of duplicating them, and
// imports each row's "Kommende Termine" cell into real termine rows,
// skipping any appointment that names a doctor not found on staff.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('imports new + existing patients and their upcoming appointments correctly', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [
      { id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' },
      { id: 'u2', vorname: 'Jonas', nachname: 'Berger', full_name: 'Dr. Jonas Berger', role: 'arzt', fach: 'Kardiologie', is_admin: false, email: 'j@a.at', username: 'dr.berger' },
    ],
    practice_settings: [{ id: true }],
    patients: [{ id: 'existing-p1', username: 'josef.bauer', full_name: 'Josef Bauer', name: 'Josef', versicherung: 'ÖGK', svnr: '4567180452', dob: '1952-04-18', join_status: 'approved' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);

  // Row 1: brand-new patient (Maria Huber) with one appointment for a real
  // doctor plus one for an unknown doctor name (must be skipped, not
  // guessed at). Row 2: an EXISTING patient (Josef Bauer, matched via
  // SVNr) with a valid appointment for a different real doctor -- must
  // update the existing row, not create a duplicate.
  const csv = 'Vorname,Nachname,Geburtsdatum,SVNr,Versicherung,Telefon,Kommende Termine\n'
    + 'Maria,Huber,14.03.1985,1234140385,ÖGK,+43 664 1234567,"Kontrolle|15.08.2026|09:30|Dr. Sarah Ahmed; Blutabnahme|01.09.2026|10:00|Dr. Unbekannt"\n'
    + 'Josef,Bauer,18.04.1952,4567180452,ÖGK,+43 664 6789012,Kardiologie-Kontrolle|20.08.2026|11:00|Dr. Jonas Berger';

  const result = await page.evaluate(async (csvText) => {
    await patientsReady;
    document.getElementById('importCsvText').value = csvText;
    proceedToMapping();
    await confirmImport();
    await new Promise(r => setTimeout(r, 100));
    return {
      patients: window.__store.patients,
      termine: window.__store.termine,
    };
  }, csv);

  const maria = result.patients.find(p => p.full_name === 'Maria Huber');
  const mariaTermine = result.termine.filter(t => t.patient_id === maria.id);
  expect(maria, 'Maria Huber must have been created').toBeTruthy();
  expect(mariaTermine, 'the unknown-doctor appointment must be skipped, only the valid one imported').toHaveLength(1);
  expect(mariaTermine[0].arzt_id).toBe('u1');
  expect(mariaTermine[0].status).toBe('bestaetigt');

  expect(result.patients.filter(p => p.full_name === 'Josef Bauer'), 'the existing patient must be updated, not duplicated').toHaveLength(1);
  const josefTermin = result.termine.find(t => t.patient_id === 'existing-p1');
  expect(josefTermin, 'the existing patient still gets their imported appointment').toBeTruthy();
  expect(josefTermin.arzt_id).toBe('u2');
});

test('imports Diagnosen/Allergien/Blutgruppe and Impfungen for a new patient', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);

  const csv = 'Vorname,Nachname,Geburtsdatum,Diagnosen,Allergien,Blutgruppe,Impfungen\n'
    + 'Anna,Fischer,05.06.1990,Asthma,Penizillin,A+,"FSME:10.03.2024;Grippe:15.11.2025"';

  const result = await page.evaluate(async (csvText) => {
    await Promise.all([patientsReady, impfungenReady]);
    document.getElementById('importCsvText').value = csvText;
    proceedToMapping();
    await confirmImport();
    await new Promise(r => setTimeout(r, 100));
    return {
      patients: window.__store.patients,
      impfungen: window.__store.patient_impfungen,
    };
  }, csv);

  const anna = result.patients.find(p => p.full_name === 'Anna Fischer');
  expect(anna, 'Anna Fischer must have been created').toBeTruthy();
  expect(anna.diagnosen).toBe('Asthma');
  expect(anna.allergie).toBe('Penizillin');
  expect(anna.blutgruppe).toBe('A+');
  const annaImpfungen = result.impfungen.filter(i => i.patient_id === anna.id);
  expect(annaImpfungen, 'both vaccination entries must have been inserted into patient_impfungen').toHaveLength(2);
  expect(annaImpfungen.map(i => i.vaccine_name).sort()).toEqual(['FSME', 'Grippe']);
});

// Regression test for a real gap: createPatientAccount()'s auth-user
// provisioning (ensurePatientAuthUser -> create-patient-auth-user) is
// fire-and-forget by design for the interactive "+ Neuer Patient" flow, so
// a `patients` row could be created successfully while the actual login
// silently never got provisioned -- and the CSV import summary had no way
// to know that, reporting the row as a full, unqualified success. confirmImport()
// now also awaits createPatientAccount()'s new authPromise for this exact reason.
test('a row whose patients-record saves fine but whose real login fails to provision is still flagged in the results', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    sb.functions.invoke = (name) => name === 'create-patient-auth-user'
      ? Promise.resolve({ data: null, error: { message: 'simulated edge function failure' } })
      : Promise.resolve({ data: null, error: null });
  });

  const csv = 'Vorname,Nachname\nLukas,Wagner';
  const result = await page.evaluate(async (csvText) => {
    await patientsReady;
    document.getElementById('importCsvText').value = csvText;
    proceedToMapping();
    await confirmImport();
    await new Promise(r => setTimeout(r, 100));
    return {
      patients: window.__store.patients,
      lastResults: window._lastImportResults,
      warningIconShown: document.getElementById('importResultRows').innerHTML.includes('⚠'),
    };
  }, csv);

  const lukas = result.patients.find(p => p.full_name === 'Lukas Wagner');
  expect(lukas, 'the patients row itself must still have been created').toBeTruthy();
  const lukasResult = result.lastResults.find(r => r.name === 'Lukas Wagner');
  expect(lukasResult.syncFailed, 'a failed login-provisioning step must be flagged, not silently reported as a full success').toBe(true);
  expect(result.warningIconShown).toBe(true);
});
