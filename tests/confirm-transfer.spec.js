// Regression test for the confirmTransfer()/bulkReassignTermine() fix:
// a real DB error must abort the "Weiterleiten" flow (no fake success
// message to the patient), and the toast must always state what actually
// happened rather than a blanket "success" claim.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function setup(page) {
  await installMockSupabase(page, {
    staff_profiles: [
      { id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' },
      { id: 'u2', vorname: 'Jonas', nachname: 'Berger', full_name: 'Dr. Jonas Berger', role: 'arzt', fach: 'Kardiologie', is_admin: false, email: 'j@a.at', username: 'dr.berger' },
    ],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({
      'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' },
      'dr.berger': { username: 'dr.berger', fullName: 'Dr. Jonas Berger', role: 'arzt', isAdmin: false, fach: 'Kardiologie' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
}

test('a real DB error aborts the transfer instead of falsely claiming success', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    window.__store.termine = [];
    window.__forceError = { termine: 'simulated db error' };
    transferPatientForModal = 'Maria Huber';
    transferSelectedDoctor = 'dr.berger';
    document.getElementById('transferModal').classList.add('show');
    await confirmTransfer();
    await new Promise(r => setTimeout(r, 50));
    return {
      toastText: document.getElementById('toast')?.textContent || '',
      modalStillOpen: document.getElementById('transferModal').classList.contains('show'),
    };
  });
  expect(result.toastText).toContain('fehlgeschlagen');
  expect(result.modalStillOpen, 'the modal must stay open on a real error').toBe(true);
});

test('zero upcoming appointments is reported honestly, not as a blanket success', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    window.__store.termine = [];
    transferPatientForModal = 'Maria Huber';
    transferSelectedDoctor = 'dr.berger';
    document.getElementById('transferModal').classList.add('show');
    await confirmTransfer();
    await new Promise(r => setTimeout(r, 50));
    return {
      toastText: document.getElementById('toast')?.textContent || '',
      modalStillOpen: document.getElementById('transferModal').classList.contains('show'),
    };
  });
  expect(result.toastText).toContain('keine anstehenden Termine');
  expect(result.modalStillOpen, 'the forward itself still succeeded, so the modal should close').toBe(false);
});

test('real upcoming appointments are actually reassigned and the count is stated', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    window.__store.termine = [
      { id: 't1', patient_name: 'Maria Huber', arzt_id: 'dr.ahmed', status: 'bestaetigt', date: '2026-08-01', time: '09:00' },
      { id: 't2', patient_name: 'Maria Huber', arzt_id: 'dr.ahmed', status: 'bestaetigt', date: '2026-08-05', time: '10:00' },
    ];
    transferPatientForModal = 'Maria Huber';
    transferSelectedDoctor = 'dr.berger';
    document.getElementById('transferModal').classList.add('show');
    await confirmTransfer();
    await new Promise(r => setTimeout(r, 50));
    return {
      toastText: document.getElementById('toast')?.textContent || '',
      reassigned: window.__store.termine.every(t => t.arzt_id === 'dr.berger'),
    };
  });
  expect(result.toastText).toContain('2 Termine übertragen');
  expect(result.reassigned, 'both appointments must actually move to the colleague').toBe(true);
});
