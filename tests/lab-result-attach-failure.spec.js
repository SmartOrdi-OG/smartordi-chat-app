// Regression test found while battle-testing the newer lab-result-inbox
// feature (Cloudflare Email Routing -> supabase/functions/receive-lab-email
// -> lab_result_uploads): attachLabResultToPatient() (vendor/staff-accounts.js)
// called uploadPatientDocument() -- which throws on a real failure, not
// returns false -- with no try/catch around it. A genuine DB error there
// would propagate as an uncaught rejection straight out of
// assignLabResult() in doctor.html (which also had no try/catch of its
// own), so the doctor would see NOTHING at all: no success toast, but also
// not the existing "✗ Zuordnung fehlgeschlagen" error toast, since the code
// never reached that check. Fixed by catching the upload failure inside
// attachLabResultToPatient() and returning false, letting the existing
// caller-side error toast actually fire.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

// NOTE: forceUploadError must be a plain boolean, not a function -- an
// extraInit callback passed through installMockSupabase() is serialized by
// Playwright's addInitScript() and run inside the BROWSER, which has no
// access to a Node-side closure over another function reference (an
// earlier version of this test tried to forward an outer JS callback that
// way; it silently failed to ever set window.__forceError, since that
// reference doesn't exist once the script runs in the page's own context).
async function setupPage(page, forceUploadError) {
  const initFn = forceUploadError ? () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
    window.__forceError = { patient_documents: 'simulated insert failure' };
  } : () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  };
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
    lab_result_uploads: [{ id: 'lr1', practice_id: 'p1', patient_name: 'Laborbefund', sender_email: 'lab@extern.at', subject: 'Blutbild', filename: 'befund.pdf', mime_type: 'application/pdf', file_data: 'ZmFrZQ==', status: 'pending', created_at: new Date().toISOString() }],
  }, initFn);
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await patientsReady; });
}

test('a failed document upload shows the real error toast instead of silently doing nothing', async ({ page }) => {
  await setupPage(page, true);
  await page.evaluate(async () => {
    await renderLabResultInbox(); // renders the real #labResultPatient-lr1 select
    document.getElementById('labResultPatient-lr1').value = 'p1';
    await assignLabResult('lr1');
  });
  const toast = await page.evaluate(() => ({
    text: document.getElementById('toast')?.textContent || '',
    isError: document.getElementById('toast')?.className.includes('error'),
  }));
  expect(toast.text, 'a failed upload must show the real error toast, not stay silent').toBe('✗ Zuordnung fehlgeschlagen');
  expect(toast.isError).toBe(true);

  const row = await page.evaluate(() => window.__store.lab_result_uploads.find(r => r.id === 'lr1'));
  expect(row.status, 'a failed attach must not mark the row attached -- it should stay pending for retry').toBe('pending');
});

test('a successful attach shows the success toast and marks the row attached', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(async () => {
    await renderLabResultInbox(); // renders the real #labResultPatient-lr1 select
    document.getElementById('labResultPatient-lr1').value = 'p1';
    await assignLabResult('lr1');
  });
  const toast = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
  expect(toast).toBe('✓ Befund zur Akte hinzugefügt');

  const state = await page.evaluate(() => ({
    row: window.__store.lab_result_uploads.find(r => r.id === 'lr1'),
    doc: window.__store.patient_documents.find(d => d.patient_id === 'p1'),
  }));
  expect(state.row.status).toBe('attached');
  expect(state.row.matched_patient_id).toBe('p1');
  expect(state.doc, 'the lab result must actually land in patient_documents').toBeTruthy();
  expect(state.doc.category).toBe('labor');
});
