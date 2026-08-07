// Regression test for the Monat (month) view added to #tuHome's Tagesuhr
// calendar alongside the existing Tag/Woche views -- not a replacement,
// same "additive" pattern as Woche (see tuhome-week-view.spec.js and the
// #tuHome CSS comments). Mirrors secretary.html's own Termine month grid
// (renderSecTermineCalendar): clicking a day cell opens its appointments in
// a floating window beside the cell (tuCalWindow), reusing Tag view's own
// tuApptCardHtml cards (Start/Fertig controls included) instead of a
// read-only row list.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function ymd(d) { return d.toISOString().slice(0, 10); }

test('Monat view shows a full month grid with appointment chips, and the day view is hidden', async ({ page }) => {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const mid = new Date(today.getFullYear(), today.getMonth(), 15);

  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [{ id: 'p1', username: 'ahmad', full_name: 'Ahmad Saadat', name: 'Ahmad', join_status: 'approved' }],
    termine: [
      { id: 't1', patient_id: 'p1', patient_name: 'Ahmad Saadat', art: 'Kontrolle', date: ymd(mid), time: '08:00', end_time: '08:30', status: 'bestaetigt', arzt_id: 'u1' },
    ],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  await page.evaluate((firstStr) => { tuSelectDate(firstStr); tuSetViewMode('monat'); }, ymd(first));

  const state = await page.evaluate(() => ({
    mode: tuViewMode,
    cellCount: document.querySelectorAll('#tuCalGrid .tu-cal-day').length,
    monthGridVisible: getComputedStyle(document.getElementById('tuMonthGridWrap')).display !== 'none',
    dayLayoutHidden: getComputedStyle(document.querySelector('.tu-day-layout')).display === 'none',
    chipText: document.querySelector('#tuCalGrid .tu-cal-day-chip')?.textContent || '',
  }));
  expect(state.mode).toBe('monat');
  expect(state.cellCount % 7, 'grid is always a whole number of weeks').toBe(0);
  expect(state.monthGridVisible).toBe(true);
  expect(state.dayLayoutHidden).toBe(true);
  expect(state.chipText).toContain('08:00');
  expect(state.chipText).toContain('Ahmad');
});

test('clicking a day cell selects that day, stays in Monat view, and shows its appointments in a floating window beside the grid', async ({ page }) => {
  const today = new Date();
  const target = new Date(today.getFullYear(), today.getMonth(), 20);

  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [{ id: 'p1', username: 'maria', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
    termine: [
      { id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Erstgespräch', date: ymd(target), time: '11:00', end_time: '11:45', status: 'bestaetigt', arzt_id: 'u1' },
    ],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => { tuSetViewMode('monat'); });

  await page.evaluate((ds) => { tuCalSelectDay(ds); }, ymd(target));

  const state = await page.evaluate((ds) => ({
    mode: tuViewMode,
    selected: tuSelectedDate,
    monthGridVisible: getComputedStyle(document.getElementById('tuMonthGridWrap')).display !== 'none',
    windowVisible: getComputedStyle(document.getElementById('tuCalWindow')).display !== 'none',
    detailNames: [...document.querySelectorAll('#tuCalWindowBody .tu-appt-card')].map(c => c.textContent),
    selectedCellHighlighted: !!document.querySelector(`.tu-cal-day.selected`),
  }), ymd(target));
  expect(state.mode, 'stays in Monat view -- does not jump to Tag').toBe('monat');
  expect(state.selected).toBe(ymd(target));
  expect(state.monthGridVisible).toBe(true);
  expect(state.windowVisible, 'the floating window opens on click').toBe(true);
  expect(state.selectedCellHighlighted).toBe(true);
  expect(state.detailNames.some(t => t.includes('Maria Huber')), 'floating window shows the clicked day\'s appointment as a real tuApptCardHtml card').toBe(true);
});

test('a real click opens the floating window right next to the clicked day cell, not always the same corner', async ({ page }) => {
  const today = new Date();
  const target = new Date(today.getFullYear(), today.getMonth(), 20);

  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [{ id: 'p1', username: 'maria', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
    termine: [
      { id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Erstgespräch', date: ymd(target), time: '11:00', end_time: '11:45', status: 'bestaetigt', arzt_id: 'u1' },
    ],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => { tuSetViewMode('monat'); });

  const targetDs = ymd(target);
  const cellIndex = await page.evaluate((ds) => {
    const cells = [...document.querySelectorAll('#tuCalGrid .tu-cal-day')];
    return cells.findIndex(c => c.getAttribute('onclick')?.includes(ds));
  }, targetDs);
  expect(cellIndex).toBeGreaterThan(-1);

  const cellBox = await page.locator('#tuCalGrid .tu-cal-day').nth(cellIndex).boundingBox();
  await page.locator('#tuCalGrid .tu-cal-day').nth(cellIndex).click();
  await page.waitForTimeout(150);

  const winBox = await page.locator('#tuCalWindow').boundingBox();
  // The window should land close to the clicked cell -- not off in some
  // fixed corner of the screen regardless of where the grid was.
  expect(Math.abs(winBox.y - cellBox.y)).toBeLessThan(400);
});

test('shifting month via the toolbar arrow browses independently without losing the selected day', async ({ page }) => {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const nextMonthFirst = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [],
    termine: [],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate((firstStr) => { tuSelectDate(firstStr); tuSetViewMode('monat'); }, ymd(first));

  await page.evaluate(() => { tuShiftView(1); });

  const state = await page.evaluate(() => ({
    calYear: tuCalYear, calMonth: tuCalMonth,
    selected: tuSelectedDate, // unchanged -- shifting the grid's browsed month must not silently reselect a day
    label: document.getElementById('tuDayLabel').textContent,
  }));
  expect(state.calYear).toBe(nextMonthFirst.getFullYear());
  expect(state.calMonth).toBe(nextMonthFirst.getMonth());
  expect(state.selected).toBe(ymd(first));
  expect(state.label).toContain(String(nextMonthFirst.getFullYear()));
});
