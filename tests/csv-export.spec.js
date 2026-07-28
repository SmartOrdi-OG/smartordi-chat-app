// Regression test for doctor.html's single-patient CSV export
// (exportPatientCsv()/csvEscape()) -- had no dedicated spec at all before,
// despite real quoting/escaping logic. Also a fresh audit finding: free-text
// fields (Diagnosen, Krankengeschichte) can themselves originate from an old
// system's CSV import, i.e. attacker-controlled text this doctor never
// typed -- a cell starting with =, +, - or @ is read as a formula (not
// text) by Excel/Sheets when the exported file is opened there, a classic
// CSV/formula-injection risk. csvEscape() now prefixes such a cell with a
// single quote (Excel's own "force text" marker).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(patientOverrides) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [Object.assign({ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', adresse: 'Hauptstraße 1, 4020 Linz', join_status: 'approved' }, patientOverrides)],
  };
}

async function exportCsvFor(page, name) {
  return await page.evaluate(async (n) => {
    await patientsReady;
    document.getElementById('kartei-name').textContent = n;
    let captured;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (blob) => { captured = blob; return 'blob:stub'; };
    const origRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = () => {};
    await exportPatientCsv();
    URL.createObjectURL = orig;
    URL.revokeObjectURL = origRevoke;
    return await captured.text();
  }, name);
}

test('exports the expected header row and fields, quoting a comma-containing Adresse', async ({ page }) => {
  await installMockSupabase(page, seed({ diagnosen: 'Migräne', allergie: 'Penizillin', blutgruppe: 'A+' }), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const csv = await exportCsvFor(page, 'Maria Huber');
  const lines = csv.replace(/^﻿/, '').split('\n');
  expect(lines[0]).toBe('Vorname,Nachname,Geburtsdatum,SVNr,Versicherung,Telefon,Adresse,Diagnosen,Allergien,Blutgruppe,Impfungen,Krankengeschichte');
  expect(lines[1]).toContain('Maria,Huber,1985-01-01,123,ÖGK');
  expect(lines[1]).toContain('"Hauptstraße 1, 4020 Linz"');
  expect(lines[1]).toContain('Migräne');
  expect(lines[1]).toContain('Penizillin');
  expect(lines[1]).toContain('A+');
});

test('a Diagnosen/Krankengeschichte cell starting with =, +, - or @ is prefixed with a single quote, not left as a live formula', async ({ page }) => {
  await installMockSupabase(page, seed({ adresse: 'Teststr 5', diagnosen: '=cmd|\'/c calc\'!A1', legacy_history: '+1+1', allergie: '-2+3', blutgruppe: '@SUM(A1:A9)' }), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const csv = await exportCsvFor(page, 'Maria Huber');
  const row = csv.replace(/^﻿/, '').split('\n')[1];
  const cells = row.split(',');
  // Diagnosen (index 7), Allergien (8), Blutgruppe (9), Krankengeschichte (11)
  expect(cells[7].startsWith("'=cmd"), 'a leading = must be neutralized').toBe(true);
  expect(cells[8].startsWith("'-2"), 'a leading - must be neutralized').toBe(true);
  expect(cells[9].startsWith("'@SUM"), 'a leading @ must be neutralized').toBe(true);
  expect(row).toContain("'+1+1");
});

test('a normal Diagnosen value with no leading formula character is exported unmodified', async ({ page }) => {
  await installMockSupabase(page, seed({ diagnosen: 'Typ-2-Diabetes' }), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const csv = await exportCsvFor(page, 'Maria Huber');
  expect(csv).toContain('Typ-2-Diabetes');
  expect(csv).not.toContain("'Typ-2-Diabetes");
});
