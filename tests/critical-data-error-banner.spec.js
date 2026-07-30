// Regression test for a real production incident: refreshPatients() (and
// the other core clinical data caches) used to fail completely silently --
// a real Postgres error just got console.error()'d and the cache stayed
// empty, which looks EXACTLY like "this practice genuinely has no
// patients" to a doctor/secretary actually looking at the screen. This
// covers the fix: setCriticalDataErrorHandler()/reportCriticalDataError()
// now show a persistent, impossible-to-miss banner instead.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('doctor.html shows the data-load error banner when refreshPatients() fails, not a silent empty list', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
    window.__forceError = { patients: 'simulated missing column' };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const bannerVisible = await page.evaluate(() => getComputedStyle(document.getElementById('dataLoadErrorBanner')).display !== 'none');
  expect(bannerVisible, 'a failed patient-data load must show a visible warning, not silently look like zero patients').toBe(true);
});

test('secretary.html shows the data-load error banner when refreshPatients() fails', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
    window.__forceError = { patients: 'simulated missing column' };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);

  const bannerVisible = await page.evaluate(() => getComputedStyle(document.getElementById('dataLoadErrorBanner')).display !== 'none');
  expect(bannerVisible).toBe(true);
});

// Regression test for a real question the user asked: this banner is 100%
// local to whichever browser tab happened to be open the moment the error
// occurred -- if they weren't physically at that practice's device, nothing
// about the failure would ever reach them. supabase/phase46_client_error_
// log.sql + logClientErrorRemotely() (vendor/staff-accounts.js) fix that by
// also logging every reportCriticalDataError() call to a central table the
// practice owner can query directly, regardless of which practice/device it
// happened on.
test('a critical data-load failure is also logged to client_error_log, not just shown locally', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
    window.__forceError = { patients: 'simulated missing column' };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const logged = await page.evaluate(() => window.__store.client_error_log);
  expect(logged.length).toBeGreaterThan(0);
  const entry = logged.find(e => e.context === 'refreshPatients');
  expect(entry, 'refreshPatients() failing must be logged under that exact context').toBeTruthy();
  expect(entry.error_message).toContain('simulated missing column');
  expect(entry.page).toBe('doctor.html');
});

test('a failure logging the error remotely never breaks or hides the local banner', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
    // Both the real failure AND the remote-logging attempt itself fail here --
    // the local banner must still show up regardless.
    window.__forceError = { patients: 'simulated missing column', client_error_log: 'also down' };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const bannerVisible = await page.evaluate(() => getComputedStyle(document.getElementById('dataLoadErrorBanner')).display !== 'none');
  expect(bannerVisible, 'the remote log failing must never take the local banner down with it').toBe(true);
});

test('the banner stays hidden on a normal, successful load', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const bannerVisible = await page.evaluate(() => getComputedStyle(document.getElementById('dataLoadErrorBanner')).display !== 'none');
  expect(bannerVisible).toBe(false);
});
