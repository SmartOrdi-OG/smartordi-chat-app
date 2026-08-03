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

// Regression test for patient search-on-demand PR5 (see TODO.md):
// findExistingPatientForImportRow() now queries Supabase live per row
// instead of scanning loadPatients()'s in-memory list -- this must not
// silently break confirmImport()'s existing read-after-write requirement,
// where a LATER row in the same import can match a patient an EARLIER row
// in that same run just created (not one already in the seed data).
test('a later row in the same import correctly matches (by SVNr) a patient an earlier row in that same import just created', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);

  // Row 1 creates "Petra Wagner" fresh (SVNr 5551234567). Row 2 is the SAME
  // real person (same SVNr, address update) -- must UPDATE the row-1-created
  // record, not create a second "Petra Wagner" account.
  const csv = 'Vorname,Nachname,SVNr,Adresse\n'
    + 'Petra,Wagner,5551234567,Alte Gasse 1\n'
    + 'Petra,Wagner,5551234567,Neue Gasse 5';

  const result = await page.evaluate(async (csvText) => {
    await patientsReady;
    document.getElementById('importCsvText').value = csvText;
    proceedToMapping();
    await confirmImport();
    await new Promise(r => setTimeout(r, 100));
    return { patients: window.__store.patients };
  }, csv);

  const petras = result.patients.filter(p => p.full_name === 'Petra Wagner');
  expect(petras, 'row 2 must update the patient row 1 just created, not create a duplicate').toHaveLength(1);
  expect(petras[0].adresse).toBe('Neue Gasse 5');
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
      warningIconShown: document.getElementById('importResultRows').innerHTML.includes('title="Serverabgleich fehlgeschlagen"'),
    };
  }, csv);

  const lukas = result.patients.find(p => p.full_name === 'Lukas Wagner');
  expect(lukas, 'the patients row itself must still have been created').toBeTruthy();
  const lukasResult = result.lastResults.find(r => r.name === 'Lukas Wagner');
  expect(lukasResult.syncFailed, 'a failed login-provisioning step must be flagged, not silently reported as a full success').toBe(true);
  expect(result.warningIconShown).toBe(true);
});

// Regression test for a gap flagged by the user's "is this 100% ready?"
// question: the "Kommende Termine" cell only ever produced upcoming,
// outstanding appointments -- an old system's export naturally also
// contains PAST visits, and importing one as a plain unqualified
// "bestaetigt" appointment would misrepresent it as still awaiting the
// patient. importTermineFromRow() now sets completed_at for any imported
// date that's already in the past, same as a real visit doctor.html itself
// marks done.
test('a past date in the Termine cell imports as an already-completed visit, a future one does not', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);

  const csv = 'Vorname,Nachname,Kommende Termine\n'
    + 'Petra,Winter,"Altbehandlung|01.01.2020|09:00|Dr. Sarah Ahmed; Kontrolle|15.08.2030|10:00|Dr. Sarah Ahmed"';

  const result = await page.evaluate(async (csvText) => {
    await patientsReady;
    document.getElementById('importCsvText').value = csvText;
    proceedToMapping();
    await confirmImport();
    await new Promise(r => setTimeout(r, 100));
    return { patients: window.__store.patients, termine: window.__store.termine };
  }, csv);

  const petra = result.patients.find(p => p.full_name === 'Petra Winter');
  const petraTermine = result.termine.filter(t => t.patient_id === petra.id);
  expect(petraTermine).toHaveLength(2);
  const past = petraTermine.find(t => t.date === '2020-01-01');
  const future = petraTermine.find(t => t.date === '2030-08-15');
  expect(past.completed_at, 'a past imported appointment must be marked completed, not left as outstanding').toBeTruthy();
  expect(future.completed_at, 'a future imported appointment must stay outstanding').toBeFalsy();
});

// Regression test for the second gap: past treatment/visit notes
// (doctor.html's Kartei "Verlauf" tab, patient_visits) had no import path
// at all -- only upcoming appointments and vaccinations did.
test('imports past treatment history into patient_visits for both a new and an existing patient', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [{ id: 'existing-p2', username: 'thomas.klein', full_name: 'Thomas Klein', name: 'Thomas', versicherung: 'ÖGK', svnr: '9988770101', dob: '1970-01-01', join_status: 'approved' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);

  const csv = 'Vorname,Nachname,SVNr,Behandlungsverlauf\n'
    + 'Elena,Roth,,"12.01.2023|Kontrolle|Grippe|Ausgeheilt nach 1 Woche"\n'
    + 'Thomas,Klein,9988770101,"03.05.2021|Erstbehandlung|Bluthochdruck|Medikation eingestellt"';

  const result = await page.evaluate(async (csvText) => {
    await patientsReady;
    document.getElementById('importCsvText').value = csvText;
    proceedToMapping();
    await confirmImport();
    await new Promise(r => setTimeout(r, 100));
    return { patients: window.__store.patients, visits: window.__store.patient_visits, summary: document.getElementById('importResultSummary').textContent };
  }, csv);

  const elena = result.patients.find(p => p.full_name === 'Elena Roth');
  expect(elena, 'Elena Roth must have been created').toBeTruthy();
  const elenaVisit = result.visits.find(v => v.patient_id === elena.id);
  expect(elenaVisit, 'the new patient must have their imported visit in patient_visits').toBeTruthy();
  expect(elenaVisit.visit_date).toBe('2023-01-12');
  expect(elenaVisit.visit_type).toBe('Kontrolle');
  expect(elenaVisit.diagnose).toBe('Grippe');
  expect(elenaVisit.notes).toBe('Ausgeheilt nach 1 Woche');

  const thomasVisit = result.visits.find(v => v.patient_id === 'existing-p2');
  expect(thomasVisit, 'the existing (SVNr-matched) patient must also get their imported visit').toBeTruthy();
  expect(thomasVisit.diagnose).toBe('Bluthochdruck');
  expect(result.summary).toContain('2 Verlaufseintrag');
});
