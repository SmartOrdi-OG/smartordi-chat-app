// Regression test for supabase/phase28_guardian_child_accounts.sql: a
// guardian/child pair created from secretary.html's "+ Neuer Patient" (Kind)
// flow used to live ONLY in this browser's localStorage -- invisible to any
// other device, and to any staff member on a different browser. This test
// covers createChildPatientAccount() actually mirroring both the guardian
// and the child into real Supabase rows, correctly linked via guardian_id.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Kinderheilkunde', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
  }, extra);
}

async function setupPage(page, extraSeed) {
  await installMockSupabase(page, seed(extraSeed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Kinderheilkunde' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, guardiansReady]); });
}

test('creates a real guardian row and a real child row correctly linked via guardian_id', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    const r = createChildPatientAccount('Leo', 'Bauer', 'Anna', 'Bauer', { dob: '2018-04-01' });
    await r.identityPromise;
    return {
      guardians: window.__store.patient_guardians,
      children: window.__store.patients,
      isNewGuardian: r.isNewGuardian,
    };
  });
  expect(result.isNewGuardian).toBe(true);
  expect(result.guardians).toHaveLength(1);
  expect(result.guardians[0].full_name).toBe('Anna Bauer');
  expect(result.children).toHaveLength(1);
  expect(result.children[0].full_name).toBe('Leo Bauer');
  expect(result.children[0].guardian_id, 'the child must actually be linked to the real guardian row').toBe(result.guardians[0].id);
  expect(result.children[0].fach).toBe('Kinderheilkunde');
});

test('a second child under the same guardian reuses the existing real guardian row', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    const r1 = createChildPatientAccount('Leo', 'Bauer', 'Anna', 'Bauer', { dob: '2018-04-01' });
    await r1.identityPromise;
    const r2 = createChildPatientAccount('Mia', 'Bauer', 'Anna', 'Bauer', { dob: '2020-09-10' });
    await r2.identityPromise;
    return {
      guardianUsernames: [r1.guardianUsername, r2.guardianUsername],
      isNewGuardian2: r2.isNewGuardian,
      guardians: window.__store.patient_guardians,
      children: window.__store.patients,
    };
  });
  expect(result.guardianUsernames[0]).toBe(result.guardianUsernames[1]);
  expect(result.isNewGuardian2, 'the second child must not create a duplicate guardian').toBe(false);
  expect(result.guardians).toHaveLength(1);
  expect(result.children).toHaveLength(2);
  expect(result.children.every(c => c.guardian_id === result.guardians[0].id)).toBe(true);
});

test('a real save failure for the guardian/child mirror is caught, not thrown to the caller', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    window.__forceError = { patient_guardians: 'simulated DB error' };
    const r = createChildPatientAccount('Leo', 'Bauer', 'Anna', 'Bauer', { dob: '2018-04-01' });
    const identityResult = await r.identityPromise;
    delete window.__forceError;
    return { identityResult, guardians: window.__store.patient_guardians, children: window.__store.patients };
  });
  expect(result.identityResult).toBeNull();
  expect(result.guardians).toHaveLength(0);
  expect(result.children).toHaveLength(0);
});
