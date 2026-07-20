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
