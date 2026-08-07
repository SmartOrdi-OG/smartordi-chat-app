// Regression tests for two real reports (2026-08-07, with a screenshot)
// about doctor.html's Monat calendar day-cards floating window
// (#tuCalWindow, shipped in #478): it stayed open and floating on top of
// whatever tab the doctor navigated to next (real screenshot: it landed on
// top of "Kartei öffnen" in the chat overview pane, hiding it entirely --
// "لنافذة انتقلت مع kartei... لنافذة مكانها الصحيح كالندر"), and there was
// no way to move it out of the way short of closing it entirely
// ("اعمل النافذة العائمة متحركة"). Both fixes are the same underlying
// architecture in secretary.html's own #secCalWindow (Termine calendar's
// day-cards floating window), so this file covers both.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function ymd(d) { return d.toISOString().slice(0, 10); }
function ymdOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function setupDoctorPage(page, extraSeed) {
  await installMockSupabase(page, Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
  }, extraSeed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
}

async function setupSecretaryPage(page, termine) {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
    termine,
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, termineReady]); switchView('termine'); });
  await page.waitForTimeout(300);
}

test.describe('doctor.html #tuCalWindow', () => {
  test('closes automatically when navigating away from Kalender to another tab', async ({ page }) => {
    const today = new Date();
    const target = new Date(today.getFullYear(), today.getMonth(), 20);
    await setupDoctorPage(page, {
      patients: [{ id: 'p1', username: 'maria', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
      termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: ymd(target), time: '11:00', end_time: '11:45', status: 'bestaetigt', arzt_id: 'u1' }],
    });
    await page.evaluate((ds) => { tuSetViewMode('monat'); tuCalSelectDay(ds); }, ymd(target));
    const opened = await page.evaluate(() => document.getElementById('tuCalWindow').style.display !== 'none');
    expect(opened, 'sanity check -- the window actually opened').toBe(true);

    await page.evaluate(() => { switchView('clinic'); });
    const closed = await page.evaluate(() => document.getElementById('tuCalWindow').style.display === 'none');
    expect(closed, 'must not stay floating over the Praxis/chat tab after navigating away').toBe(true);
  });

  test('is draggable by its header to a new position, but not by clicking its × button', async ({ page }) => {
    const today = new Date();
    const target = new Date(today.getFullYear(), today.getMonth(), 20);
    await setupDoctorPage(page, {
      patients: [{ id: 'p1', username: 'maria', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
      termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: ymd(target), time: '11:00', end_time: '11:45', status: 'bestaetigt', arzt_id: 'u1' }],
    });
    await page.evaluate((ds) => { tuSetViewMode('monat'); tuCalSelectDay(ds); }, ymd(target));
    await page.waitForTimeout(200);

    const before = await page.locator('#tuCalWindow').boundingBox();
    const header = page.locator('#tuCalWindow .floating-chat-header');
    const headerBox = await header.boundingBox();
    await page.mouse.move(headerBox.x + 40, headerBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(headerBox.x + 340, headerBox.y + 260, { steps: 10 });
    await page.mouse.up();

    const after = await page.locator('#tuCalWindow').boundingBox();
    expect(after.x, 'window moved horizontally with the drag').not.toBe(before.x);
    expect(after.y, 'window moved vertically with the drag').not.toBe(before.y);

    // Dragging must not have broken the close button.
    await page.click('#tuCalWindow .floating-chat-close');
    const closed = await page.evaluate(() => document.getElementById('tuCalWindow').style.display === 'none');
    expect(closed).toBe(true);
  });
});

test.describe('secretary.html #secCalWindow', () => {
  test('closes automatically when navigating away from Termine to another tab', async ({ page }) => {
    await setupSecretaryPage(page, [
      { id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: ymdOffset(0), time: '09:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() },
    ]);
    await page.evaluate((d) => secCalSelectDay(d), ymdOffset(0));
    const opened = await page.evaluate(() => document.getElementById('secCalWindow').style.display !== 'none');
    expect(opened, 'sanity check -- the window actually opened').toBe(true);

    await page.evaluate(() => { switchView('patienten'); });
    const closed = await page.evaluate(() => document.getElementById('secCalWindow').style.display === 'none');
    expect(closed, 'must not stay floating over the Patienten tab after navigating away').toBe(true);
  });

  test('is draggable by its header to a new position', async ({ page }) => {
    await setupSecretaryPage(page, [
      { id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: ymdOffset(0), time: '09:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() },
    ]);
    await page.evaluate((d) => secCalSelectDay(d), ymdOffset(0));
    await page.waitForTimeout(200);

    const before = await page.locator('#secCalWindow').boundingBox();
    const header = page.locator('#secCalWindow .floating-chat-header');
    const headerBox = await header.boundingBox();
    await page.mouse.move(headerBox.x + 40, headerBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(headerBox.x + 300, headerBox.y + 220, { steps: 10 });
    await page.mouse.up();

    const after = await page.locator('#secCalWindow').boundingBox();
    expect(after.x, 'window moved horizontally with the drag').not.toBe(before.x);
    expect(after.y, 'window moved vertically with the drag').not.toBe(before.y);
  });
});
