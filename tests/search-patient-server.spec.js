// Regression test for doctor.html's "such-name"/"such-svnr"/"such-dob"
// search form (searchPatient()) -- PR2 of the patient-search-on-demand
// rollout (see TODO.md). Used to filter EVERY loaded patient in JS
// (loadQrPatientAccounts()); now queries the server live via
// searchPatientsByCriteria() (vendor/patient-data.js), debounced. No test
// existed for this feature before this change.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extraPatients) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: extraPatients || [],
  };
}

async function setupPage(page, extraPatients) {
  await installMockSupabase(page, seed(extraPatients), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  // The "such-*" inputs live inside the Kartei panel's "Suche" tab, hidden by
  // default (display:none) until switched to -- same setup precedent as
  // tests/kartei-visit-persistence.spec.js, plus resetKarteiToSearch() (the
  // real production entry point for "open Kartei with no specific patient",
  // e.g. the top-nav Kartei icon), which is what actually reveals the Suche
  // tab's own content div, independent of the (separately gated) tab bar.
  await page.evaluate(() => {
    switchView('clinic');
    toggleKartei();
    resetKarteiToSearch();
  });
}

test('shows the placeholder when no search field is filled', async ({ page }) => {
  await setupPage(page, []);
  const text = await page.locator('#such-ergebnisse').textContent();
  expect(text).toContain('Suchbegriff eingeben');
});

test('finds a patient by typing a name (debounced)', async ({ page }) => {
  await setupPage(page, [
    { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', svnr: '111', versicherung: 'ÖGK', tel: '+43 660 1', dob: '1985-01-01', join_status: 'approved' },
    { id: 'p2', username: 'josef.bauer', full_name: 'Josef Bauer', name: 'Josef', svnr: '222', join_status: 'approved' },
  ]);
  await page.fill('#such-name', 'huber');
  await page.evaluate(() => searchPatientDebounced());
  await expect(page.locator('#such-ergebnisse')).toContainText('Maria Huber', { timeout: 2000 });
  await expect(page.locator('#such-ergebnisse')).not.toContainText('Josef Bauer');
});

test('finds a patient by birth date alone, with no name or SVNr typed', async ({ page }) => {
  await setupPage(page, [
    { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', dob: '1985-06-15', join_status: 'approved' },
    { id: 'p2', username: 'josef.bauer', full_name: 'Josef Bauer', name: 'Josef', dob: '1970-01-01', join_status: 'approved' },
  ]);
  await page.fill('#such-dob', '1985-06-15');
  await page.evaluate(() => searchPatientDebounced());
  await expect(page.locator('#such-ergebnisse')).toContainText('Maria Huber', { timeout: 2000 });
  await expect(page.locator('#such-ergebnisse')).not.toContainText('Josef Bauer');
});

test('combining name and SVNr requires BOTH to match the same patient (AND, not OR)', async ({ page }) => {
  await setupPage(page, [
    { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', svnr: '1112223334', join_status: 'approved' },
    { id: 'p2', username: 'josef.bauer', full_name: 'Josef Bauer', name: 'Josef', svnr: '9998887776', join_status: 'approved' },
  ]);
  // Maria's own name, but Josef's SVNr -- must match nobody.
  await page.fill('#such-name', 'maria');
  await page.fill('#such-svnr', '999');
  await page.evaluate(() => searchPatientDebounced());
  await expect(page.locator('#such-ergebnisse')).toContainText('Kein Patient gefunden', { timeout: 2000 });
});

test('shows "Kein Patient gefunden" for a name that matches nobody', async ({ page }) => {
  await setupPage(page, [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }]);
  await page.fill('#such-name', 'nichtvorhanden');
  await page.evaluate(() => searchPatientDebounced());
  await expect(page.locator('#such-ergebnisse')).toContainText('Kein Patient gefunden', { timeout: 2000 });
});
