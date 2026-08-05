// Regression/feature test for a user-requested Kalender/Tagesuhr workflow
// change: clicking "▶ Start" on an appointment used to just mark it started
// (started_at) and re-render the day view -- the doctor still had to
// separately find that patient in Praxis and open their Kartei by hand.
// tuMarkStarted() now also opens that exact patient's Kartei directly (via
// the already-existing openKarteiForPatientAndShow(), the same one the
// Kalender row's "⋮" menu already used), and the topbar's global "Zurück"
// button (goBack(), which always returns to Kalender -- see
// topbar-back-button.spec.js) now auto-completes that same visit
// (completed_at) on the way back, so the doctor lands back on Kalender with
// the appointment already showing "Fertig" instead of needing to find and
// click that row's own Fertig button afterward.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(terminOverrides) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'karl.gruber', full_name: 'Karl Gruber', name: 'Karl', versicherung: 'ÖGK', svnr: '456', dob: '1970-02-02', join_status: 'approved' }],
    termine: [Object.assign({
      id: 't1', patient_id: 'p1', patient_name: 'Karl Gruber', art: 'Kontrolle',
      date: '2026-08-05', time: '13:00', end_time: '13:20', status: 'neu', arzt_id: 'u1',
      versicherung: 'ÖGK', svnr: '456', dob: '1970-02-02',
      created_at: new Date().toISOString(),
    }, terminOverrides)],
  };
}

async function setupPage(page, terminOverrides) {
  await installMockSupabase(page, seed(terminOverrides), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, termineReady]); });
}

test('"▶ Start" opens that exact patient\'s Kartei directly, not just a marked-started row', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    await tuMarkStarted('t1');
    return {
      terminStarted: !!loadTermine().find(t => t.id === 't1').startedAt,
      clinicViewActive: document.getElementById('view-clinic').classList.contains('active'),
      karteiName: document.getElementById('kartei-name').textContent,
    };
  });
  expect(result.terminStarted, 'the termin is marked started').toBe(true);
  expect(result.clinicViewActive, 'the Praxis/Kartei view becomes active').toBe(true);
  expect(result.karteiName).toContain('Karl Gruber');
});

test('topbar "Zurück" after a "Start" auto-completes that same visit and returns to Kalender showing Fertig', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(async () => { await tuMarkStarted('t1'); });
  await page.evaluate(() => { goBack(); });
  await page.waitForFunction(() => !!loadTermine().find(t => t.id === 't1').completedAt);
  const result = await page.evaluate(() => ({
    onKalender: document.body.classList.contains('mobile-tuhome-active'),
    clinicViewActive: document.getElementById('view-clinic').classList.contains('active'),
    fertigChipShown: (loadTermine().find(t => t.id === 't1')),
  }));
  expect(result.onKalender, 'Zurück still lands on Kalender').toBe(true);
  expect(result.clinicViewActive, 'the Kartei/Praxis view is no longer active').toBe(false);
  expect(result.fertigChipShown.completedAt, 'the visit is now marked completed').toBeTruthy();
});

test('a plain "Zurück" with no preceding "Start" behaves exactly as before (no completeTerminVisit call, no crash)', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(() => {
    goBack();
    return {
      onKalender: document.body.classList.contains('mobile-tuhome-active'),
      terminUntouched: !loadTermine().find(t => t.id === 't1').startedAt && !loadTermine().find(t => t.id === 't1').completedAt,
    };
  });
  expect(result.onKalender).toBe(true);
  expect(result.terminUntouched, 'a termin never Started is untouched by a plain Zurück').toBe(true);
});

test('starting a second visit without returning from the first only auto-completes the second on Zurück (documented edge case)', async ({ page }) => {
  await setupPage(page, undefined);
  await page.evaluate(async () => {
    // Seed a second termin directly into the in-memory store the same way
    // refreshTermine() would have loaded it, then re-run the mapping so
    // loadTermine() sees both.
    window.__store.termine.push({
      id: 't2', patient_id: 'p1', patient_name: 'Karl Gruber', art: 'Kontrolle',
      date: '2026-08-05', time: '14:00', end_time: '14:20', status: 'neu', arzt_id: 'u1',
      versicherung: 'ÖGK', svnr: '456', dob: '1970-02-02', created_at: new Date().toISOString(),
    });
    await refreshTermine();
    await tuMarkStarted('t1');
    await tuMarkStarted('t2');
  });
  await page.evaluate(() => { goBack(); });
  await page.waitForFunction(() => !!loadTermine().find(t => t.id === 't2').completedAt);
  const result = await page.evaluate(() => ({
    t1Completed: !!loadTermine().find(t => t.id === 't1').completedAt,
    t2Completed: !!loadTermine().find(t => t.id === 't2').completedAt,
  }));
  expect(result.t2Completed, 'the second (most-recently-started) visit is auto-completed').toBe(true);
  expect(result.t1Completed, 'the first visit is NOT auto-completed -- its own inline Fertig button still covers it').toBe(false);
});
