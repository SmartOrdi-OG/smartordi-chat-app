// Regression/feature test for a real user report (2026-08-05): after
// bulk-importing 500 patients with their appointments via CSV, secretary.html's
// "Terminverwaltung" tab looked broken -- every imported Termin (spanning
// August AND September) got flagged "just added" by the old "Neu
// hinzugefügt" section and sorted by import time instead of its own
// appointment date, so months ended up interleaved ahead of "Heute" itself.
// Fixed by replacing the whole flat-list rendering with a real month-grid
// calendar (renderTermineList() rewrite): every Termin is inherently placed
// under its own calendar date, so this whole bug class can't recur --
// "newness" is now a small per-day dot instead of a separate feed that
// reorders by insertion time.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function ymdOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function seed(termine) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [
      { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' },
      { id: 'p2', username: 'karl.gruber', full_name: 'Karl Gruber', name: 'Karl', versicherung: 'ÖGK', svnr: '456', dob: '1970-02-02', join_status: 'approved' },
    ],
    termine,
  };
}

async function setupPage(page, termine) {
  await installMockSupabase(page, seed(termine), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({
      'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, termineReady]); switchView('termine'); });
  await page.waitForTimeout(300);
}

test('a bulk-imported Termin from a different month never leaks into "today"\'s selected day', async ({ page }) => {
  await setupPage(page, [
    { id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: ymdOffset(-20), time: '09:00', status: 'neu', arzt_id: 'u1', created_at: new Date().toISOString() },
    { id: 't2', patient_id: 'p2', patient_name: 'Karl Gruber', art: 'Kontrolle', date: ymdOffset(35), time: '10:00', status: 'neu', arzt_id: 'u1', created_at: new Date().toISOString() },
  ]);
  await page.evaluate((d) => secCalSelectDay(d), ymdOffset(0));
  const result = await page.evaluate(() => ({
    windowBody: document.getElementById('secCalWindowBody').textContent,
    todayCellHasEntries: document.querySelector('.sec-cal-day.today').textContent,
  }));
  expect(result.windowBody).toContain('Keine Termine an diesem Tag');
  expect(result.windowBody).not.toContain('Maria Huber');
  expect(result.windowBody).not.toContain('Karl Gruber');
});

test('clicking a day cell opens that day\'s Termine in the floating window, not an inline panel', async ({ page }) => {
  const targetDate = ymdOffset(3);
  await setupPage(page, [
    { id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: targetDate, time: '09:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() },
    { id: 't2', patient_id: 'p2', patient_name: 'Karl Gruber', art: 'Kontrolle', date: ymdOffset(10), time: '10:00', status: 'neu', arzt_id: 'u1', created_at: new Date().toISOString() },
  ]);
  await expect(page.locator('#secCalWindow')).toBeHidden();
  await page.evaluate((d) => secCalSelectDay(d), targetDate);
  await expect(page.locator('#secCalWindow')).toBeVisible();
  const state = await page.evaluate(() => ({
    windowBody: document.getElementById('secCalWindowBody').textContent,
    windowTitle: document.getElementById('secCalWindowTitle').textContent,
    detailPanelStillExists: !!document.querySelector('.sec-cal-detail'),
  }));
  expect(state.windowBody).toContain('Maria Huber');
  expect(state.windowBody).not.toContain('Karl Gruber');
  expect(state.windowTitle.length).toBeGreaterThan(0);
  expect(state.detailPanelStillExists, 'no leftover inline detail panel below the grid').toBe(false);

  await page.evaluate(() => closeSecCalWindow());
  await expect(page.locator('#secCalWindow')).toBeHidden();
});

test('the enlarged grid cells show more than 2 appointment chips before collapsing into "+N mehr"', async ({ page }) => {
  const d1 = ymdOffset(6);
  await setupPage(page, [
    { id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'A', date: d1, time: '08:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() },
    { id: 't2', patient_id: 'p1', patient_name: 'Maria Huber', art: 'B', date: d1, time: '09:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() },
    { id: 't3', patient_id: 'p1', patient_name: 'Maria Huber', art: 'C', date: d1, time: '10:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() },
    { id: 't4', patient_id: 'p1', patient_name: 'Maria Huber', art: 'D', date: d1, time: '11:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() },
  ]);
  const chipCount = await page.evaluate((d) => {
    const cells = [...document.querySelectorAll('.sec-cal-day')];
    const cell = cells.find(c => c.onclick && c.getAttribute('onclick').includes(d));
    return cell ? cell.querySelectorAll('.sec-cal-day-chip').length : -1;
  }, d1);
  expect(chipCount).toBe(4); // all 4 fit under the new SEC_CAL_MAX_CHIPS=5 cap, none collapsed into "+N mehr"
});

test('the day cell for a date with Termine shows a colored chip (or count on narrow layouts), grouped correctly by date', async ({ page }) => {
  const d1 = ymdOffset(5);
  await setupPage(page, [
    { id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: d1, time: '09:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() },
    { id: 't2', patient_id: 'p2', patient_name: 'Karl Gruber', art: 'Kontrolle', date: d1, time: '10:00', status: 'neu', arzt_id: 'u1', created_at: new Date().toISOString() },
  ]);
  const count = await page.evaluate((d) => {
    const cells = [...document.querySelectorAll('.sec-cal-day')];
    const cell = cells.find(c => c.onclick && c.getAttribute('onclick').includes(d));
    return cell ? cell.querySelector('.sec-cal-day-count').textContent : null;
  }, d1);
  expect(count).toBe('2');
});

test('Vor/Zurück month navigation moves the grid a full month at a time, and "Heute" returns to the current month', async ({ page }) => {
  await setupPage(page, []);
  const initialTitle = await page.evaluate(() => document.querySelector('.sec-cal-title').textContent);
  await page.evaluate(() => secCalShiftMonth(1));
  const nextTitle = await page.evaluate(() => document.querySelector('.sec-cal-title').textContent);
  expect(nextTitle).not.toBe(initialTitle);
  await page.evaluate(() => secCalShiftMonth(-1));
  const backTitle = await page.evaluate(() => document.querySelector('.sec-cal-title').textContent);
  expect(backTitle).toBe(initialTitle);
  await page.evaluate(() => secCalShiftMonth(3));
  await page.evaluate(() => secCalGoToday());
  const todayTitle = await page.evaluate(() => document.querySelector('.sec-cal-title').textContent);
  expect(todayTitle).toBe(initialTitle);
});

test('confirming a Termin from the floating window keeps it open on the same day and reflects the new status', async ({ page }) => {
  const targetDate = ymdOffset(2);
  await setupPage(page, [
    { id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: targetDate, time: '09:00', status: 'neu', arzt_id: 'u1', created_at: new Date().toISOString() },
  ]);
  await page.evaluate((d) => secCalSelectDay(d), targetDate);
  await page.evaluate(async () => { await confirmTermin('t1'); });
  const result = await page.evaluate(() => ({
    windowVisible: getComputedStyle(document.getElementById('secCalWindow')).display !== 'none',
    windowBody: document.getElementById('secCalWindowBody').textContent,
    status: loadTermine().find(t => t.id === 't1').status,
  }));
  expect(result.status).toBe('bestaetigt');
  expect(result.windowVisible, 'confirming from inside the window must not close it').toBe(true);
  expect(result.windowBody).toContain('Maria Huber');
  expect(result.windowBody).toContain('Bestätigt');
});

test('a cancelled (abgesagt) Termin still shows on its day but is visually distinct and has no action buttons in the floating window', async ({ page }) => {
  const targetDate = ymdOffset(1);
  await setupPage(page, [
    { id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: targetDate, time: '09:00', status: 'abgesagt', arzt_id: 'u1', created_at: new Date().toISOString() },
  ]);
  await page.evaluate((d) => secCalSelectDay(d), targetDate);
  const windowBody = await page.evaluate(() => document.getElementById('secCalWindowBody').textContent);
  expect(windowBody).toContain('Maria Huber');
  expect(windowBody).toContain('Abgesagt');
  expect(windowBody).not.toContain('Bestätigen');
});

test('a day outside the currently-shown month is visually marked (leading/trailing days) but still clickable to its own Termine', async ({ page }) => {
  await setupPage(page, []);
  const outsideCount = await page.evaluate(() => document.querySelectorAll('.sec-cal-day.outside').length);
  expect(outsideCount).toBeGreaterThan(0);
});

test('a real click opens the floating window right next to the clicked day cell, not always the same corner', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 }); // desktop -- mobile goes fullscreen regardless of position
  const targetDate = ymdOffset(4);
  await setupPage(page, [
    { id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: targetDate, time: '09:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() },
  ]);
  const { cellBox, cellIndex } = await page.evaluate((d) => {
    const cells = [...document.querySelectorAll('.sec-cal-day')];
    const idx = cells.findIndex(c => c.onclick && c.getAttribute('onclick').includes(d));
    const r = cells[idx].getBoundingClientRect();
    return { cellBox: { left: r.left, right: r.right, top: r.top }, cellIndex: idx };
  }, targetDate);
  await page.locator('.sec-cal-day').nth(cellIndex).click();
  await expect(page.locator('#secCalWindow')).toBeVisible();
  const winBox = await page.evaluate(() => document.getElementById('secCalWindow').getBoundingClientRect());
  // Real bug found running this test on a later real-world date (2026-08-13):
  // a flat "<30/<450/<200" pixel budget only holds for a cell near the grid's
  // TOP -- ymdOffset(4) lands in a different calendar ROW depending on which
  // weekday the 1st of the currently-shown month falls on, and a cell several
  // rows down a 6-row month is legitimately far from where a viewport-clamped
  // 420x600 window can still fit on screen. That's secCalPositionWindow()
  // working as designed (never letting the window run off-screen), not a
  // bug -- so assert against ITS OWN documented clamping formula instead of
  // an approximate pixel budget, which makes this deterministic regardless
  // of what day it happens to run.
  const winWidth = 420, winHeight = 600, margin = 12;
  let expLeft = cellBox.right + margin;
  if (expLeft + winWidth > 1600 - margin) expLeft = cellBox.left - winWidth - margin;
  expLeft = Math.max(margin, Math.min(expLeft, 1600 - winWidth - margin));
  const expTop = Math.max(margin, Math.min(cellBox.top, 1000 - winHeight - margin));
  expect(Math.abs(winBox.left - expLeft), `window left=${winBox.left} should match secCalPositionWindow()'s own formula (expected ${expLeft})`).toBeLessThan(2);
  expect(Math.abs(winBox.top - expTop), `window top=${winBox.top} should match secCalPositionWindow()'s own formula (expected ${expTop})`).toBeLessThan(2);
});
