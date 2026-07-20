// Regression test for supabase/phase17_data_retention.sql's request_patient_deletion
// flow: secretary.html's "Datenlöschung beantragen" button must reflect
// whichever outcome the server RPC actually returns (immediate
// anonymization vs. a scheduled future date under the 10-year § 51
// ÄrzteG retention), never a generic success message.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function setup(page) {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true, adresse: 'Steingasse 6A, 4020 Linz', tel: '+43 677 62439293', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  page.on('dialog', d => d.accept());
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
}

test('immediate anonymization: server says retention already expired', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    await patientsReady;
    sb.rpc = async (name) => name === 'request_patient_deletion'
      ? { data: [{ anonymized_immediately: true, effective_or_scheduled_date: '2026-07-19' }], error: null }
      : { data: null, error: null };
    openPatientDetail('Maria Huber', '#000', 'ÖGK', 'Addr 1', '+43 1', 'SVNR1', '1985-01-01');
    await requestPatientDeletion();
    await new Promise(r => setTimeout(r, 50));
    return {
      resultText: document.getElementById('pdDeletionResult').textContent,
      modalStillOpen: document.getElementById('patientDetailModal').classList.contains('show'),
    };
  });
  expect(result.resultText).toContain('anonymisiert');
  expect(result.modalStillOpen, 'the modal should close once anonymization is done').toBe(false);
});

test('scheduled deletion: server says retention is still running', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    await patientsReady;
    sb.rpc = async (name) => name === 'request_patient_deletion'
      ? { data: [{ anonymized_immediately: false, effective_or_scheduled_date: '2031-03-05' }], error: null }
      : { data: null, error: null };
    openPatientDetail('Maria Huber', '#000', 'ÖGK', 'Addr 1', '+43 1', 'SVNR1', '1985-01-01');
    await requestPatientDeletion();
    await new Promise(r => setTimeout(r, 50));
    return { resultText: document.getElementById('pdDeletionResult').textContent };
  });
  expect(result.resultText).toContain('2031');
  expect(result.resultText).toContain('§ 51 ÄrzteG');
});
