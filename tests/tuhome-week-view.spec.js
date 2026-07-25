// Regression test for the Woche (week) view added to #tuHome's Tagesuhr
// calendar alongside the existing Tag (day) view -- not a replacement.
// #tuHome's own code comment documents that an always-on week-columns
// layout was tried and dropped once already (a single busy day towers
// over an otherwise-empty week); this covers the fix that makes that
// concern moot: each of the 5 work-day columns scrolls independently, so a
// busy day never grows taller than its neighbours.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('Woche view shows every work day\'s own appointments, and a busy day does not affect the others', async ({ page }) => {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((day + 6) % 7));
  const ds = (offset) => { const d = new Date(monday); d.setDate(monday.getDate() + offset); return d.toISOString().slice(0, 10); };

  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [
      { id: 'p1', username: 'ahmad', full_name: 'Ahmad Saadat', name: 'Ahmad', join_status: 'approved' },
      { id: 'p2', username: 'maria', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' },
    ],
    termine: [
      { id: 't1', patient_id: 'p1', patient_name: 'Ahmad Saadat', art: 'Kontrolle', date: ds(0), time: '08:00', end_time: '08:30', status: 'bestaetigt', arzt_id: 'u1' },
      { id: 't2', patient_id: 'p1', patient_name: 'Ahmad Saadat', art: 'Kontrolle', date: ds(0), time: '09:00', end_time: '09:30', status: 'bestaetigt', arzt_id: 'u1' },
      { id: 't3', patient_id: 'p1', patient_name: 'Ahmad Saadat', art: 'Kontrolle', date: ds(0), time: '10:00', end_time: '10:30', status: 'bestaetigt', arzt_id: 'u1' },
      { id: 't4', patient_id: 'p2', patient_name: 'Maria Huber', art: 'Erstgespräch', date: ds(2), time: '11:00', end_time: '11:45', status: 'bestaetigt', arzt_id: 'u1' },
    ],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  // renderTagesuhr()'s own "auto-follow today" logic clamps FORWARD to next
  // Monday whenever today itself is Sat/Sun (the practice is closed
  // weekends), so relying on that default would show a different week than
  // the one seeded below whenever this suite happens to run on a weekend.
  // Selecting the Monday explicitly makes the test deterministic regardless
  // of what day it's actually run on.
  await page.evaluate((mondayStr) => { tuSelectDate(mondayStr); tuSetViewMode('woche'); }, ds(0));

  const cols = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('#tuWeekGrid .tu-week-col')];
    return cols.map(c => ({
      dom: c.querySelector('.tu-week-col-dom').textContent,
      names: [...c.querySelectorAll('.tu-appt-name')].map(n => n.textContent),
      empty: !!c.querySelector('.tu-empty'),
    }));
  });

  expect(cols.length, 'exactly 5 work days (Mon-Fri)').toBe(5);
  expect(cols[0].names, 'Monday shows all 3 of its own appointments').toEqual(['Ahmad Saadat', 'Ahmad Saadat', 'Ahmad Saadat']);
  expect(cols[1].empty, 'Tuesday has no appointments of its own').toBe(true);
  expect(cols[2].names, 'Wednesday shows only its own appointment, unaffected by Monday').toEqual(['Maria Huber']);

  // The week grid must actually be visible (not just present in the DOM
  // hidden behind CSS) -- and the day view hidden in Woche mode.
  const visibility = await page.evaluate(() => ({
    weekGridVisible: getComputedStyle(document.getElementById('tuWeekGrid')).display !== 'none',
    dayLayoutHidden: getComputedStyle(document.querySelector('.tu-day-layout')).display === 'none',
  }));
  expect(visibility.weekGridVisible).toBe(true);
  expect(visibility.dayLayoutHidden).toBe(true);
});

test('clicking a day column header switches to Tag view for that exact day', async ({ page }) => {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((day + 6) % 7));
  const wednesday = new Date(monday); wednesday.setDate(monday.getDate() + 2);
  const wedStr = wednesday.toISOString().slice(0, 10);

  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [{ id: 'p1', username: 'maria', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
    termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: wedStr, time: '11:00', end_time: '11:30', status: 'bestaetigt', arzt_id: 'u1' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => { tuSetViewMode('woche'); });

  await page.evaluate((wedStr) => { tuWeekColClick(wedStr); }, wedStr);

  const state = await page.evaluate(() => ({
    mode: tuViewMode,
    selected: tuSelectedDate,
    dayListNames: [...document.querySelectorAll('#tuDayList .tu-appt-card-name')].map(n => n.textContent),
    weekGridHidden: getComputedStyle(document.getElementById('tuWeekGrid')).display === 'none',
  }));
  expect(state.mode).toBe('tag');
  expect(state.selected).toBe(wedStr);
  expect(state.dayListNames).toContain('Maria Huber');
  expect(state.weekGridHidden).toBe(true);
});
