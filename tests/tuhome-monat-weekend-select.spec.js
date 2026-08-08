// Regression test for a real bug found via a Playwright run on an actual
// Saturday (2026-08-08): Monat's day grid, unlike Tag/Woche's day-strip, is
// NOT restricted to weekdays -- clicking a day cell always calls
// tuCalSelectDay(). That function used to route through the shared
// tuSelectDate(), which sets tuFollowingToday=true whenever the picked date
// happens to equal real "today". renderTagesuhr()'s weekend-clamp (added
// for Tag/Woche's default/auto-refresh view, so it never lands on a closed
// Sat/Sun) then fired for THIS case too, silently overwriting
// tuSelectedDate to the following Monday -- so clicking directly on a
// Saturday cell with a real appointment opened a floating window next to
// that Saturday, but showing Monday's (empty) appointments instead.
//
// Uses Playwright's clock API to force "today" to a real, known Saturday
// regardless of what day this suite actually runs on, so this test is not
// itself only-fails-on-weekends.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('clicking directly on a Saturday cell in Monat view shows that Saturday, not the following Monday', async ({ page }) => {
  const saturday = '2026-08-08'; // confirmed Saturday
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [{ id: 'p1', username: 'maria', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
    termine: [
      { id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Notfall', date: saturday, time: '09:00', end_time: '09:30', status: 'bestaetigt', arzt_id: 'u1' },
    ],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.clock.setFixedTime(new Date(saturday + 'T10:00:00'));
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => { tuSetViewMode('monat'); });

  await page.evaluate((ds) => { tuCalSelectDay(ds); }, saturday);

  const state = await page.evaluate(() => ({
    selected: tuSelectedDate,
    followingToday: tuFollowingToday,
    windowVisible: getComputedStyle(document.getElementById('tuCalWindow')).display !== 'none',
    cardNames: [...document.querySelectorAll('#tuCalWindowBody .tu-appt-card')].map(c => c.textContent),
  }));
  expect(state.selected, 'must stay on the exact Saturday clicked, not clamp to Monday').toBe(saturday);
  expect(state.followingToday, 'an explicit Monat day pick must not silently re-enable Tag/Woche\'s auto-follow-today').toBe(false);
  expect(state.windowVisible).toBe(true);
  expect(state.cardNames.some(t => t.includes('Maria Huber')), 'the floating window must show the Saturday appointment that was actually clicked').toBe(true);
});
