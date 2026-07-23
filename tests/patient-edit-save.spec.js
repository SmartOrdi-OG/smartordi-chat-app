// Regression test for a real bug found in the same investigation as
// doctor.html's saveAnamnese() false-success bug: secretary.html's
// savePatientEdit() (the "Stammdaten" edit form reachable from a patient's
// row or from inside their chat) showed "✓ Stammdaten gespeichert"
// unconditionally at the end, regardless of whether the save actually ran.
// A patient with no real Supabase account (findPatientByFullName returns
// null) silently skipped the whole save -- the entire body was wrapped in
// `if(found){...}` -- and still fell through to the same success toast and
// closed the modal as if nothing was wrong.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'sekretaerin', is_admin: true, email: 'a@a.at', username: 'sek1' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', adresse: 'Alte Adresse 1', tel: '0111', join_status: 'approved' }],
  };
}

async function setupPage(page) {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'sek1': { username: 'sek1', fullName: 'Test Sek', role: 'sekretaerin', isAdmin: false } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await patientsReady; });
}

test('refuses (no false success) for a patient with no real Supabase account', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    openPatientDetail('Ghost Patient', '#999', 'ÖGK', 'Adresse', '0000', '000', '1990-01-01');
    document.getElementById('pdAdresse').value = 'Neue Adresse 5';
    await savePatientEdit();
    return {
      toast: document.getElementById('toast')?.textContent || '',
      modalOpen: document.getElementById('patientDetailModal').classList.contains('show'),
    };
  });
  expect(result.toast).not.toContain('✓');
  expect(result.toast).toContain('Cloud-Konto');
  expect(result.modalOpen).toBe(true);
});

test('actually saves the edited fields to the real patient record', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    openPatientDetail('Maria Huber', '#999', 'ÖGK', 'Alte Adresse 1', '0111', '123', '1985-01-01');
    document.getElementById('pdAdresse').value = 'Neue Adresse 5, 1010 Wien';
    document.getElementById('pdTel').value = '0699 1234567';
    await savePatientEdit();
    return {
      toast: document.getElementById('toast')?.textContent || '',
      modalOpen: document.getElementById('patientDetailModal').classList.contains('show'),
      saved: window.__store.patients.find(p => p.username === 'maria.huber'),
    };
  });
  expect(result.toast).toContain('gespeichert');
  expect(result.modalOpen).toBe(false);
  expect(result.saved.adresse).toBe('Neue Adresse 5, 1010 Wien');
  expect(result.saved.tel).toBe('0699 1234567');
});

test('shows a failure toast (not a false success) when the save call itself fails', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    openPatientDetail('Maria Huber', '#999', 'ÖGK', 'Alte Adresse 1', '0111', '123', '1985-01-01');
    document.getElementById('pdAdresse').value = 'Neue Adresse 5';
    window.__forceError = { patients: 'simulated DB error' };
    await savePatientEdit();
    delete window.__forceError;
    return {
      toast: document.getElementById('toast')?.textContent || '',
      modalOpen: document.getElementById('patientDetailModal').classList.contains('show'),
      saved: window.__store.patients.find(p => p.username === 'maria.huber'),
    };
  });
  expect(result.toast).toContain('fehlgeschlagen');
  expect(result.toast).not.toContain('✓');
  expect(result.modalOpen).toBe(true);
  expect(result.saved.adresse).toBe('Alte Adresse 1');
});
