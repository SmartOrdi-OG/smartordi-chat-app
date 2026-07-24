// Regression test for the fix that prevents a repeat of the 2026-07-24
// incident: a migration adding patients.anamnese hadn't actually been
// applied, so refreshPatients()'s explicit column list (a later,
// unrelated performance optimization) failed outright and the entire
// patient list vanished with no visible error. selectWithColumnFallback()
// (vendor/patient-data.js) now retries with select('*') when the explicit
// list itself is what failed -- this proves that retry actually recovers
// real data instead of leaving the cache empty, using the mock's
// window.__forceErrorOnColumns (fails only a non-'*' select, unlike the
// blunter window.__forceError which fails every select unconditionally).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('refreshPatients() recovers via select(*) when the explicit column list fails, instead of leaving the patient list empty', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
    window.__forceErrorOnColumns = { patients: 'column patients.anamnese does not exist' };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const patients = await page.evaluate(() => Object.values(loadPatients()).map(p => p.fullName));
  expect(patients, 'the explicit-column failure must not black out the patient list -- select(*) should still have recovered it').toContain('Maria Huber');

  const bannerVisible = await page.evaluate(() => getComputedStyle(document.getElementById('dataLoadErrorBanner')).display !== 'none');
  expect(bannerVisible, 'a recovered load should not show the critical-error banner').toBe(false);
});

test('refreshTermine()/refreshImpfungen()/refreshAllMessages() recover the same way', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
    termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: '2026-07-24', time: '09:00', end_time: '09:30', status: 'bestaetigt', arzt_id: 'u1' }],
    patient_impfungen: [{ id: 'i1', patient_id: 'p1', vaccine_key: 'mmr', vaccine_name: 'MMR', dose_label: 'D1', datum: '2020-01-01' }],
    patient_messages: [{ id: 'm1', patient_id: 'p1', dir: 'in', type: 'text', text: 'Hallo', created_at: '2026-07-24T09:00:00Z' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
    window.__forceErrorOnColumns = {
      termine: 'column termine.reason_note does not exist',
      patient_impfungen: 'column patient_impfungen.next_due does not exist',
      patient_messages: 'column patient_messages.doc_sub does not exist',
    };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const state = await page.evaluate(() => ({
    termine: loadTermine().map(t => t.patient),
    // loadImpfungenFor() returns raw rows (impfRowToJs() remaps at the
    // point of use, not in the cache itself) -- so vaccine_name, not
    // vaccineName.
    impfungen: loadImpfungenFor('p1').map(i => i.vaccine_name),
    messages: loadMessagesForPatientCached('p1').map(m => m.text),
  }));
  expect(state.termine).toContain('Maria Huber');
  expect(state.impfungen).toContain('MMR');
  expect(state.messages).toContain('Hallo');
});
