// Regression test for supabase/phase13_prevent_double_booking.sql's app-
// side pre-check (findTermineConflict()) in secretary.html -- the real,
// race-safe guarantee is the DB's unique partial index, but this client
// check is what gives the secretary an immediate, friendly warning
// instead of a raw constraint-violation error.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('secretary.html flags same-doctor and same-patient slot conflicts, but not a genuinely free slot', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [
      { id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' },
      { id: 'u2', vorname: 'Jonas', nachname: 'Berger', full_name: 'Dr. Jonas Berger', role: 'arzt', fach: 'Kardiologie', is_admin: false, email: 'j@a.at', username: 'dr.berger' },
    ],
    practice_settings: [{ id: true, adresse: 'Steingasse 6A, 4020 Linz', tel: '+43 677 62439293', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
    termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: '2026-08-15', time: '09:30', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({
      'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' },
      'dr.berger': { username: 'dr.berger', fullName: 'Dr. Jonas Berger', role: 'arzt', isAdmin: false, fach: 'Kardiologie' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    await Promise.all([patientsReady, termineReady]);
    const patientConflict = findTermineConflict({ date: '2026-08-15', time: '09:30', arztUsername: 'u2', patient: 'Maria Huber' });
    const arztConflict = findTermineConflict({ date: '2026-08-15', time: '09:30', arztUsername: 'u1', patient: 'Someone Else' });
    const noConflict = findTermineConflict({ date: '2026-08-16', time: '10:00', arztUsername: 'u2', patient: 'Someone Else' });
    return { patientConflict, arztConflict, noConflict };
  });

  expect(result.patientConflict, 'same patient + different doctor + same time -> "patient" conflict').toBe('patient');
  expect(result.arztConflict, 'different patient + same doctor + same time -> "arzt" conflict').toBe('arzt');
  expect(result.noConflict, 'a genuinely free slot must not be flagged').toBeNull();
});

test("confirmNewTermin() refuses to create a duplicate booking when there's a conflict", async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [
      { id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' },
      { id: 'u2', vorname: 'Jonas', nachname: 'Berger', full_name: 'Dr. Jonas Berger', role: 'arzt', fach: 'Kardiologie', is_admin: false, email: 'j@a.at', username: 'dr.berger' },
    ],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
    termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: '2026-08-15', time: '09:30', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({
      'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' },
      'dr.berger': { username: 'dr.berger', fullName: 'Dr. Jonas Berger', role: 'arzt', isAdmin: false, fach: 'Kardiologie' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);

  const counts = await page.evaluate(async () => {
    await Promise.all([patientsReady, termineReady]);
    document.getElementById('ntPatient').innerHTML = '<option>Maria Huber</option>';
    document.getElementById('ntArzt').innerHTML = '<option value="u2">Dr. Jonas Berger</option>';
    document.getElementById('newTerminDate').value = '2026-08-15';
    document.getElementById('ntTime').value = '09:30';
    document.getElementById('ntEndTime').value = '10:00';
    document.getElementById('ntArt').value = 'Kontrolle';
    const before = window.__store.termine.length;
    confirmNewTermin();
    await new Promise(r => setTimeout(r, 200));
    return { before, after: window.__store.termine.length };
  });

  expect(counts.after, 'no new termin should be created when the slot conflicts').toBe(counts.before);
});
