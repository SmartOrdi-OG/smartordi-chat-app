// Regression test for the first app-code wiring of real Supabase Auth for
// patients/guardians (supabase/phase31_patient_auth.sql,
// supabase/functions/create-patient-auth-user): every place secretary.html
// creates or resets a patient/guardian credential must also provision (or
// repair) that person's real Supabase Auth user, via
// ensurePatientAuthUser() (vendor/patient-data.js) calling the
// create-patient-auth-user Edge Function. This only covers the CLIENT
// side of that wiring -- the Edge Function itself talks to Supabase's
// Admin API, which can't be exercised from this mocked-Supabase sandbox.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
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
}

test('createPatientAccount() provisions a real Auth user with the same temp password shown in the QR code', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    const calls = [];
    sb.functions.invoke = async (name, opts) => { calls.push({ name, opts }); return { data: { ok: true }, error: null }; };
    const r = createPatientAccount('Maria', 'Huber', {});
    await r.identityPromise;
    return { calls, password: r.password, patientRow: window.__store.patients.find(p => p.username === r.username) };
  });
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0].name).toBe('create-patient-auth-user');
  expect(result.calls[0].opts.body.kind).toBe('patient');
  expect(result.calls[0].opts.body.id).toBe(result.patientRow.id);
  expect(result.calls[0].opts.body.password).toBe(result.password);
});

test('createChildPatientAccount() provisions the new guardian\'s real Auth user, but never one for the child', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    const calls = [];
    sb.functions.invoke = async (name, opts) => { calls.push({ name, opts }); return { data: { ok: true }, error: null }; };
    const r = createChildPatientAccount('Leo', 'Bauer', 'Anna', 'Bauer', { dob: '2018-04-01' });
    await r.identityPromise;
    return { calls, guardianRow: window.__store.patient_guardians.find(g => g.full_name === 'Anna Bauer') };
  });
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0].opts.body.kind).toBe('guardian');
  expect(result.calls[0].opts.body.id).toBe(result.guardianRow.id);
});

test('createChildPatientAccount() does not re-provision an already-migrated returning guardian', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    const r1 = createChildPatientAccount('Leo', 'Bauer', 'Anna', 'Bauer', { dob: '2018-04-01' });
    await r1.identityPromise;
    const calls = [];
    sb.functions.invoke = async (name, opts) => { calls.push({ name, opts }); return { data: { ok: true }, error: null }; };
    const r2 = createChildPatientAccount('Mia', 'Bauer', 'Anna', 'Bauer', { dob: '2020-09-10' });
    await r2.identityPromise;
    return { calls };
  });
  expect(result.calls, 'a returning guardian already has a real account -- no new Auth user needed').toHaveLength(0);
});

test('approveJoinRequest() provisions a real Auth user by copying the existing hash, not a new password', async ({ page }) => {
  await setupPage(page, {
    patient_join_requests: [
      { id: 'jr1', username: 'neuer.patient', vorname: 'Neuer', full_name: 'Neuer Patient', pw_hash: 'hashed-secret', status: 'pending', submitted_at: '2026-07-01T10:00:00Z' },
    ],
  });
  const result = await page.evaluate(async () => {
    const calls = [];
    sb.functions.invoke = async (name, opts) => { calls.push({ name, opts }); return { data: { ok: true }, error: null }; };
    await approveJoinRequest('neuer.patient');
    await new Promise(r => setTimeout(r, 200));
    return { calls, patientRow: window.__store.patients.find(p => p.username === 'neuer.patient') };
  });
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0].opts.body.kind).toBe('patient');
  expect(result.calls[0].opts.body.id).toBe(result.patientRow.id);
  expect(result.calls[0].opts.body.existingHash).toBe('hashed-secret');
  expect(result.calls[0].opts.body.password).toBeUndefined();
});

test('resetPatientPassword() provisions/repairs the real Auth user with the new temp password', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
  });
  const result = await page.evaluate(async () => {
    await patientsReady;
    const calls = [];
    sb.functions.invoke = async (name, opts) => { calls.push({ name, opts }); return { data: { ok: true }, error: null }; };
    window.confirm = () => true;
    document.getElementById('pdTitle').dataset.name = 'Maria Huber';
    await resetPatientPassword();
    return { calls, newPw: document.getElementById('pdNewPwResult').textContent };
  });
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0].opts.body.kind).toBe('patient');
  expect(result.calls[0].opts.body.id).toBe('p1');
  expect(result.newPw).toContain(result.calls[0].opts.body.password);
});
