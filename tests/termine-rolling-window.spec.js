// Regression test for the fix to unbounded termine growth (the harder
// half of the "unbounded data growth" risk, after the same fix was
// already applied to the bulk messages cache -- see
// messages-rolling-window.spec.js). refreshTermine() used to fetch every
// appointment ever booked, going back to the practice's very first day,
// on every page load. Now scoped to the last TERMINE_PAST_WINDOW_DAYS (730,
// vendor/patient-data.js) via a .gte('date', cutoff) filter -- past only,
// no upper bound, since future-booked appointments are naturally
// self-limiting. A patient's own long-term visit history for
// continuity-of-care purposes lives in the separate patient_visits table
// (getVisitsForPatient()), never in termine, so nothing clinical is lost
// by this window -- only how far back the live Kalender view can casually
// scroll without a page reload.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('the termine cache excludes appointments older than the rolling window, but keeps recent and all future ones', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
    termine: [
      { id: 't-ancient', practice_id: 'p1', patient_id: 'p1', patient_name: 'Maria Huber (ancient)', art: 'Kontrolle', date: '2020-01-01', time: '09:00', end_time: '09:30', status: 'bestaetigt', arzt_id: 'u1' },
      { id: 't-recent', practice_id: 'p1', patient_id: 'p1', patient_name: 'Maria Huber (recent)', art: 'Kontrolle', date: '2026-06-01', time: '09:00', end_time: '09:30', status: 'bestaetigt', arzt_id: 'u1' },
      { id: 't-future', practice_id: 'p1', patient_id: 'p1', patient_name: 'Maria Huber (future)', art: 'Kontrolle', date: '2031-01-01', time: '09:00', end_time: '09:30', status: 'bestaetigt', arzt_id: 'u1' },
    ],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const names = await page.evaluate(() => loadTermine().map(t => t.patient));
  expect(names, 'an appointment from 2020 (older than the 730-day window) must not be in the live cache').not.toContain('Maria Huber (ancient)');
  expect(names, 'a recent appointment must still be in the cache').toContain('Maria Huber (recent)');
  expect(names, 'a future appointment must never be excluded -- only the past is windowed').toContain('Maria Huber (future)');
});
