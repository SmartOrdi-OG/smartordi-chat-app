// Feature test: doctor.html's Kalender (Tagesuhr) toolbar gets its own
// "Heute" button, mirroring secretary.html's Terminverwaltung calendar
// (secCalGoToday(), see secretary-termine-calendar.spec.js's "Vor/Zurück
// month navigation... Heute returns to the current month" test). tuGoToday()
// re-enables tuFollowingToday (so Tag/Woche snap back to today, including
// renderTagesuhr()'s own weekend-clamping) and resets Monat's independently
// browsed-away month state (tuCalYear/tuCalMonth) back to today's.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [],
    termine: [],
  };
}

async function setupPage(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, termineReady]); });
}

test('the Kalender toolbar shows a "Heute" button', async ({ page }) => {
  await setupPage(page);
  const label = await page.evaluate(() => document.querySelector('.tu-today-btn')?.textContent.trim());
  expect(label).toBe('Heute');
});

test('"Heute" returns Tag view to today after navigating to another day', async ({ page }) => {
  await setupPage(page);
  const initialLabel = await page.evaluate(() => document.getElementById('tuDayLabel').textContent);
  await page.evaluate(() => tuShiftView(3));
  const shiftedLabel = await page.evaluate(() => document.getElementById('tuDayLabel').textContent);
  expect(shiftedLabel).not.toBe(initialLabel);
  await page.evaluate(() => tuGoToday());
  const todayLabel = await page.evaluate(() => document.getElementById('tuDayLabel').textContent);
  expect(todayLabel).toBe(initialLabel);
});

test('"Heute" returns Monat view to the current month after browsing away', async ({ page }) => {
  await setupPage(page);
  const initialTitle = await page.evaluate(() => { tuSetViewMode('monat'); return document.getElementById('tuDayLabel').textContent; });
  await page.evaluate(() => tuShiftCalMonth(3));
  const shiftedTitle = await page.evaluate(() => document.getElementById('tuDayLabel').textContent);
  expect(shiftedTitle).not.toBe(initialTitle);
  await page.evaluate(() => tuGoToday());
  const todayTitle = await page.evaluate(() => document.getElementById('tuDayLabel').textContent);
  expect(todayTitle).toBe(initialTitle);
});
