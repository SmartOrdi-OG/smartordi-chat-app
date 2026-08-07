// Regression test for a real report, with a screenshot: clicking the "⋮"
// ("Weitere Optionen" -> "Kartei öffnen") on an appointment card *inside*
// doctor.html's Monat-mode floating day-appointments window (#tuCalWindow,
// class .floating-chat-window, z-index:300) opened #tuRowMenu (the shared
// .kartei-mehr-menu, z-index:200) -- but 200 < 300 meant the menu rendered
// BEHIND the very window its card lives in, so "Kartei öffnen" was
// unreachable. Fixed with an #tuRowMenu-specific z-index override above
// .floating-chat-window's.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function ymd(d) { return d.toISOString().slice(0, 10); }

async function setupPage(page) {
  const target = new Date();
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'maria', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
    termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: ymd(target), time: '11:00', end_time: '11:45', status: 'bestaetigt', arzt_id: 'u1' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  return target;
}

test('"⋮" -> "Kartei öffnen" menu opened from a card inside #tuCalWindow renders above the window, not behind it', async ({ page }) => {
  const target = await setupPage(page);
  await page.evaluate((ds) => { tuSetViewMode('monat'); tuCalSelectDay(ds); }, ymd(target));
  const opened = await page.evaluate(() => document.getElementById('tuCalWindow').style.display !== 'none');
  expect(opened, 'sanity check -- tuCalWindow actually opened').toBe(true);

  await page.locator('#tuCalWindow .tu-row-menu-btn').first().click();
  const menuVisible = await page.evaluate(() => document.getElementById('tuRowMenu').style.display !== 'none');
  expect(menuVisible, 'sanity check -- tuRowMenu actually opened').toBe(true);

  const zIndexes = await page.evaluate(() => ({
    menu: parseInt(getComputedStyle(document.getElementById('tuRowMenu')).zIndex, 10),
    win: parseInt(getComputedStyle(document.getElementById('tuCalWindow')).zIndex, 10),
  }));
  expect(zIndexes.menu, 'tuRowMenu must stack above the tuCalWindow it was opened from').toBeGreaterThan(zIndexes.win);

  // "Kartei öffnen" itself must actually be clickable, not just present in the DOM.
  await page.locator('#tuRowMenu .tu-row-menu-item').click();
  const karteiOpen = await page.evaluate(() => document.getElementById('kartei-name')?.textContent);
  expect(karteiOpen).toContain('Maria Huber');
});
