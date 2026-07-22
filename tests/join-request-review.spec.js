// Regression test for approveJoinRequest()/rejectJoinRequest() in
// secretary.html -- this is the gate that turns a patient's own self-signup
// (submitted with zero auth from patient-login.html's "Anmeldung
// beantragen" screen) into a real, approved patient identity. Nothing
// previously verified that approving actually creates/updates the identity
// row with join_status:'approved' (and copies the pw_hash so the patient
// can really log in), that rejecting never does either, or that a
// non-pending request can't be approved/rejected twice.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patient_join_requests: [
      { id: 'jr1', username: 'neuer.patient', vorname: 'Neuer', full_name: 'Neuer Patient', adresse: 'Musterstr 1', svnr: '1234567890', pw_hash: 'hashed-secret', status: 'pending', submitted_at: '2026-07-01T10:00:00Z' },
    ],
  };
}

async function setupPage(page) {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
}

test('approving a join request creates an approved patient identity with the copied pw_hash', async ({ page }) => {
  await setupPage(page);

  const result = await page.evaluate(async () => {
    await approveJoinRequest('neuer.patient');
    await new Promise(r => setTimeout(r, 200));
    return {
      request: window.__store.patient_join_requests.find(r => r.username === 'neuer.patient'),
      patientRow: window.__store.patients.find(p => p.username === 'neuer.patient'),
      localAccount: JSON.parse(localStorage.getItem('smartordi_patient_accounts'))['neuer.patient'],
    };
  });

  expect(result.request.status).toBe('approved');
  expect(result.patientRow, 'a real patients row must be created in Supabase').toBeTruthy();
  expect(result.patientRow.join_status).toBe('approved');
  expect(result.patientRow.pw_hash, 'the request\'s pw_hash must be copied so the patient can actually log in').toBe('hashed-secret');
  expect(result.localAccount.joinStatus).toBe('approved');
});

test('rejecting a join request marks it rejected and never creates a patient identity', async ({ page }) => {
  await setupPage(page);

  await page.evaluate(() => { window.prompt = () => 'Falsche Praxis ausgewählt'; });
  const result = await page.evaluate(async () => {
    await rejectJoinRequest('neuer.patient');
    await new Promise(r => setTimeout(r, 200));
    return {
      request: window.__store.patient_join_requests.find(r => r.username === 'neuer.patient'),
      patientRow: window.__store.patients.find(p => p.username === 'neuer.patient'),
    };
  });

  expect(result.request.status).toBe('rejected');
  expect(result.request.note).toBe('Falsche Praxis ausgewählt');
  expect(result.patientRow, 'rejecting must never create a patients identity row').toBeFalsy();
});

test('a request that is no longer pending cannot be approved or rejected a second time', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(() => { window.prompt = () => ''; });

  const result = await page.evaluate(async () => {
    await approveJoinRequest('neuer.patient');
    await new Promise(r => setTimeout(r, 200));
    const afterFirstApprove = window.__store.patient_join_requests.find(r => r.username === 'neuer.patient').reviewed_at;

    // Second attempt: the row is already 'approved', so the .eq('status','pending')
    // guard in both functions must make this a no-op instead of re-processing it.
    await rejectJoinRequest('neuer.patient');
    await new Promise(r => setTimeout(r, 200));
    const afterReject = window.__store.patient_join_requests.find(r => r.username === 'neuer.patient');
    return { afterFirstApprove, statusAfterReject: afterReject.status, reviewedAtAfterReject: afterReject.reviewed_at };
  });

  expect(result.statusAfterReject, 'an already-approved request must not be flippable to rejected').toBe('approved');
  expect(result.reviewedAtAfterReject, 'the no-op second call must not touch reviewed_at again').toBe(result.afterFirstApprove);
});
