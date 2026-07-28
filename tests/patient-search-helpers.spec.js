// Regression tests for the new search-on-demand helpers added to
// vendor/patient-data.js (searchPatientsServer(), findPatientByFullNameServer(),
// findPatientByFullNameCached()) -- PR1 of the patient-search-on-demand
// rollout (see TODO.md). Nothing in the app calls these yet in this PR;
// these tests exercise the helpers directly. Also covers the new .ilike()/
// .or()/.limit()/.order() support added to tests/helpers/mockSupabase.js,
// since neither existed before this change.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extraPatients) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: (extraPatients || []),
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
  await page.evaluate(async () => { await patientsReady; });
}

test('searchPatientsServer() matches by full name substring, case-insensitively', async ({ page }) => {
  await setupPage(page, [
    { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', svnr: '111', join_status: 'approved' },
    { id: 'p2', username: 'josef.bauer', full_name: 'Josef Bauer', name: 'Josef', svnr: '222', join_status: 'approved' },
  ]);
  const results = await page.evaluate(() => searchPatientsServer('hUbEr'));
  expect(results).toHaveLength(1);
  expect(results[0].fullName).toBe('Maria Huber');
});

test('searchPatientsServer() matches by SVNr substring', async ({ page }) => {
  await setupPage(page, [
    { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', svnr: '1234567890', join_status: 'approved' },
    { id: 'p2', username: 'josef.bauer', full_name: 'Josef Bauer', name: 'Josef', svnr: '9999999999', join_status: 'approved' },
  ]);
  const results = await page.evaluate(() => searchPatientsServer('45678'));
  expect(results).toHaveLength(1);
  expect(results[0].fullName).toBe('Maria Huber');
});

test('searchPatientsServer() respects the limit and orders by full_name', async ({ page }) => {
  await setupPage(page, [
    { id: 'p1', username: 'u1', full_name: 'Charlie Fisch', name: 'Charlie', svnr: 'x', join_status: 'approved' },
    { id: 'p2', username: 'u2', full_name: 'Alice Fisch', name: 'Alice', svnr: 'x', join_status: 'approved' },
    { id: 'p3', username: 'u3', full_name: 'Bob Fisch', name: 'Bob', svnr: 'x', join_status: 'approved' },
  ]);
  const results = await page.evaluate(() => searchPatientsServer('fisch', 2));
  expect(results).toHaveLength(2);
  expect(results.map(r => r.fullName)).toEqual(['Alice Fisch', 'Bob Fisch']);
});

test('searchPatientsServer() returns an empty array (not a throw) on a real DB error', async ({ page }) => {
  await setupPage(page, [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }]);
  await page.evaluate(() => { window.__forceError = { patients: 'simulated db error' }; });
  const results = await page.evaluate(() => searchPatientsServer('maria'));
  expect(results).toEqual([]);
});

test('findPatientByFullNameServer() finds one patient by exact name and populates the lookup cache', async ({ page }) => {
  await setupPage(page, [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', svnr: '111', join_status: 'approved' }]);
  const result = await page.evaluate(async () => {
    const found = await findPatientByFullNameServer('Maria Huber');
    // Mutate the underlying store directly (bypassing the app) so the
    // cached copy is provably stale if findPatientByFullNameCached() ever
    // re-fetches instead of using the cache.
    window.__store.patients[0].svnr = 'CHANGED';
    const cached = findPatientByFullNameCached('Maria Huber');
    return { found, cached };
  });
  expect(result.found.svnr).toBe('111');
  expect(result.cached.svnr).toBe('111');
});

test('findPatientByFullNameServer() returns null for a name that does not exist', async ({ page }) => {
  await setupPage(page, [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }]);
  const result = await page.evaluate(() => findPatientByFullNameServer('Nobody Here'));
  expect(result).toBeNull();
});

test('findPatientByFullNameCached() falls back to the full in-memory list for a name never looked up via search', async ({ page }) => {
  await setupPage(page, [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }]);
  const result = await page.evaluate(() => findPatientByFullNameCached('Maria Huber'));
  expect(result.fullName).toBe('Maria Huber');
});
