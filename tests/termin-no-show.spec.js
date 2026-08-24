// Real gap found via competitor research (see TODO.md): 'abgesagt' only
// ever meant "the patient cancelled in advance" -- there was no way to
// record the distinct, more disruptive case of a patient simply never
// showing up. noShowTermin() (secretary.html, mirrors cancelTermin()'s own
// shape) adds 'nicht_erschienen' as a real status, and doctor.html's Kartei
// Stammdaten now shows a "Versäumte Termine" count for the currently
// selected patient. supabase/phase82_termin_no_show.sql widens the
// database's own check constraint to allow the new status value.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function baseSeed(terminOverrides) {
  return {
    staff_profiles: [
      { id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' },
    ],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
    termine: [Object.assign({
      id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle',
      date: '2026-08-15', time: '09:30', end_time: '10:00', status: 'bestaetigt', arzt_id: 'u1',
      created_at: new Date().toISOString(),
    }, terminOverrides)],
  };
}

async function setupSecretaryPage(page, terminOverrides) {
  await installMockSupabase(page, baseSeed(terminOverrides), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({
      'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, termineReady]); });
}

test('noShowTermin() marks the appointment "nicht_erschienen" without sending any chat message', async ({ page }) => {
  await setupSecretaryPage(page);
  const result = await page.evaluate(async () => {
    await noShowTermin('t1');
    const t = loadTermine().find(x => x.id === 't1');
    return {
      status: t.status,
      toastText: document.getElementById('toast').textContent,
      messages: (findPatientByFullName('Maria Huber').accounts['maria.huber'].messages || []),
    };
  });
  expect(result.status).toBe('nicht_erschienen');
  expect(result.toastText).toContain('Nicht erschienen');
  expect(result.messages.length, 'unlike cancelTermin, no chat message should be sent').toBe(0);
});

test('noShowTermin() shows a real failure toast (not silence) when the update actually fails', async ({ page }) => {
  await setupSecretaryPage(page);
  await page.evaluate(() => { window.__forceError = { termine: 'simulated db error' }; });
  const result = await page.evaluate(async () => {
    await noShowTermin('t1');
    const t = loadTermine().find(x => x.id === 't1');
    return { status: t.status, toastText: document.getElementById('toast').textContent };
  });
  expect(result.status, 'the appointment must stay untouched when the update fails').toBe('bestaetigt');
  expect(result.toastText).toContain('nicht');
  expect(result.toastText).toContain('markiert');
});

test('once marked "nicht_erschienen", the Termine list row shows no more action buttons (same as "abgesagt")', async ({ page }) => {
  await setupSecretaryPage(page, { status: 'nicht_erschienen' });
  const html = await page.evaluate(() => terminRowHtml(loadTermine().find(t => t.id === 't1'), new Set(), null));
  expect(html).toContain('Nicht erschienen');
  expect(html).not.toContain('t-btn-cancel');
  expect(html).not.toContain('t-btn-confirm');
  expect(html).not.toContain('t-btn-noshow');
});

async function setupDoctorPage(page, termineOverride) {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'karl.gruber', full_name: 'Karl Gruber', name: 'Karl', versicherung: 'ÖGK', svnr: '456', dob: '1970-02-02', join_status: 'approved' }],
    termine: termineOverride,
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, termineReady]); });
}

test('Kartei Stammdaten shows a "Versäumte Termine" count when the selected patient has no-shows on file', async ({ page }) => {
  await setupDoctorPage(page, [
    { id: 't1', patient_id: 'p1', patient_name: 'Karl Gruber', art: 'Kontrolle', date: '2026-07-01', time: '09:00', status: 'nicht_erschienen', arzt_id: 'u1', created_at: new Date().toISOString() },
    { id: 't2', patient_id: 'p1', patient_name: 'Karl Gruber', art: 'Kontrolle', date: '2026-07-10', time: '09:00', status: 'nicht_erschienen', arzt_id: 'u1', created_at: new Date().toISOString() },
    { id: 't3', patient_id: 'p1', patient_name: 'Karl Gruber', art: 'Kontrolle', date: '2026-08-01', time: '09:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() },
  ]);
  const result = await page.evaluate(() => {
    populateKarteiStamm('Karl Gruber');
    return {
      display: document.getElementById('k-stamm-noshow-row').style.display,
      text: document.getElementById('k-stamm-noshow').textContent,
    };
  });
  expect(result.display).toBe('flex');
  expect(result.text).toBe('2');
});

test('Kartei Stammdaten hides the "Versäumte Termine" row for a patient with zero no-shows', async ({ page }) => {
  await setupDoctorPage(page, [
    { id: 't1', patient_id: 'p1', patient_name: 'Karl Gruber', art: 'Kontrolle', date: '2026-08-01', time: '09:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() },
  ]);
  const result = await page.evaluate(() => {
    populateKarteiStamm('Karl Gruber');
    return document.getElementById('k-stamm-noshow-row').style.display;
  });
  expect(result).toBe('none');
});
