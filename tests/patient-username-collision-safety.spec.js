// Regression test for a real data-corruption bug found in a 2026-08-05
// codebase audit: createPatientAccount()/createChildPatientAccount()
// (secretary.html) generate a new patient's username and check it for
// uniqueness only against loadPatients()'s bounded 500-most-recently-
// active cache, plus this device's own local accounts. A patient outside
// that cache was invisible to the check -- so a generated username could
// collide with a REAL, unrelated existing patient, and the old
// upsertPatientIdentity() call (see/insert-if-new/update-if-found) would
// then silently overwrite that unrelated patient's identity row with the
// new patient's data.
//
// Fixed by insertNewPatientIdentity() (vendor/patient-data.js): a real
// INSERT that relies on the database's own `username text unique`
// constraint as the source of truth instead of a client-side existence
// check -- a genuine collision now fails loudly (Postgres 23505) and
// createPatientAccount()/createChildPatientAccount() surface a clear error
// toast instead of silently corrupting the other patient's record. This
// test forces that exact Postgres error via the mock's
// window.__forceError escape hatch (now supporting a full error object,
// not just a message string) rather than trying to reproduce a genuine
// 500-patient-cache miss, which isn't practical with a handful of seeded
// rows.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    // The "real, unrelated existing patient" whose row must survive
    // untouched -- represents someone sitting outside loadPatients()'s
    // bounded cache in the real bug scenario.
    patients: [{ id: 'p-existing', username: 'ahmad.khalil', name: 'Ahmad', full_name: 'Ahmad Khalil', fach: 'Allgemeinmedizin', dob: '1970-01-01', svnr: '999', join_status: 'approved' }],
  }, extra);
}

async function setupPage(page, extraSeed) {
  await installMockSupabase(page, seed(extraSeed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await patientsReady; });
}

test('createPatientAccount() refuses to overwrite an unrelated existing patient on a genuine username collision', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    const before = JSON.parse(JSON.stringify(window.__store.patients.find(p => p.username === 'ahmad.khalil')));
    window.__forceError = { patients: { code: '23505', message: 'duplicate key value violates unique constraint "patients_username_key"' } };
    // Same name as the existing seeded patient -- generates the exact same
    // colliding username ("ahmad.khalil"), simulating what a bounded-cache
    // miss would have let through uncaught.
    const r = createPatientAccount('Ahmad', 'Khalil', {});
    const row = await r.identityPromise;
    const authResult = await r.authPromise;
    delete window.__forceError;
    const after = window.__store.patients.find(p => p.username === 'ahmad.khalil');
    return {
      identityResult: row,
      authResult,
      toastText: document.getElementById('toast')?.textContent || '',
      before, after,
      totalPatientRows: window.__store.patients.length,
    };
  });
  expect(result.identityResult, 'a collision must resolve to null, never a row').toBeNull();
  expect(result.authResult, 'no Auth user should be provisioned for a failed insert').toBe(false);
  expect(result.toastText).toContain('Benutzername bereits vergeben');
  expect(result.after, 'the unrelated existing patient must still be exactly who they were').toEqual(result.before);
  expect(result.totalPatientRows, 'no phantom second row should have been inserted').toBe(1);
});

test('createPatientAccount() still succeeds normally when there is no collision', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    const r = createPatientAccount('Maria', 'Huber', {});
    const row = await r.identityPromise;
    return { row, toastText: document.getElementById('toast')?.textContent || '', totalPatientRows: window.__store.patients.length };
  });
  expect(result.row).not.toBeNull();
  expect(result.row.username).toBe('maria.huber');
  expect(result.totalPatientRows).toBe(2);
});

test('createChildPatientAccount() refuses to overwrite an unrelated existing patient on a genuine username collision for the child', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    const before = JSON.parse(JSON.stringify(window.__store.patients.find(p => p.username === 'ahmad.khalil')));
    window.__forceError = { patients: { code: '23505', message: 'duplicate key value violates unique constraint "patients_username_key"' } };
    // Same name as the existing seeded patient -- the child's generated
    // username collides, same scenario as the adult-flow test above.
    const r = createChildPatientAccount('Ahmad', 'Khalil', 'Fatima', 'Khalil', {});
    await r.identityPromise;
    delete window.__forceError;
    const after = window.__store.patients.find(p => p.username === 'ahmad.khalil');
    return {
      toastText: document.getElementById('toast')?.textContent || '',
      before, after,
      totalPatientRows: window.__store.patients.length,
    };
  });
  expect(result.toastText).toContain('Benutzername bereits vergeben');
  expect(result.after, 'the unrelated existing patient must still be exactly who they were').toEqual(result.before);
  expect(result.totalPatientRows, 'no phantom child row should have been inserted').toBe(1);
});
