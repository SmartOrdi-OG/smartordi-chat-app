// Regression test for secretary.html's bookTerminFromDetail() (booking an
// appointment directly from a patient's Stammdaten/detail modal, as
// opposed to the main "+ Neuer Termin" flow already covered by
// double-booking.spec.js/confirmNewTermin()).
//
// Deliberate design note (documented in the function's own comment): the
// print call (printTerminSlip) must run synchronously inside the click's
// user gesture or the browser blocks the popup, so createTermin() is
// fire-and-forget -- the "✓ Termin gebucht" toast and the printed slip
// both happen optimistically, before the insert is confirmed. A genuine
// insert failure is only surfaced afterward via .catch(). This test locks
// in that this really does happen (the .catch() isn't silently dropped),
// and that the up-front conflict pre-check still blocks a genuine
// conflict before any of that optimistic behavior kicks in.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true, adresse: 'Steingasse 6A, 4020 Linz', tel: '+43 677 62439293', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  }, extra);
}

async function setupPage(page, extraSeed) {
  await page.addInitScript(() => {
    window.open = () => ({ document: { write() {}, close() {} }, focus() {}, print() {} });
  });
  await installMockSupabase(page, seed(extraSeed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, termineReady]); });
}

test('books a real termin, shows success and prints the slip', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    openPatientDetail('Maria Huber', '#999', 'ÖGK', 'Adresse', '0111', '123', '1985-01-01');
    document.getElementById('pd-termin-datum').value = '2026-08-20';
    document.getElementById('pd-termin-zeit').value = '10:00';
    document.getElementById('pd-termin-endzeit').value = '10:30';
    document.getElementById('pd-termin-art').value = 'Kontrolle';
    document.getElementById('pd-termin-arzt').innerHTML = '<option value="u1">Dr. Sarah Ahmed</option>';
    bookTerminFromDetail();
    await new Promise(r => setTimeout(r, 200));
    return {
      toast: document.getElementById('toast')?.textContent || '',
      modalOpen: document.getElementById('patientDetailModal').classList.contains('show'),
      termine: window.__store.termine,
    };
  });
  expect(result.toast).toContain('Termin gebucht');
  expect(result.modalOpen).toBe(false);
  expect(result.termine.length).toBe(1);
  expect(result.termine[0].date).toBe('2026-08-20');
  expect(result.termine[0].time).toBe('10:00');
});

test('refuses up-front when the slot conflicts, without creating a termin or printing', async ({ page }) => {
  await setupPage(page, {
    termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: '2026-08-20', time: '10:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() }],
  });
  const result = await page.evaluate(async () => {
    openPatientDetail('Maria Huber', '#999', 'ÖGK', 'Adresse', '0111', '123', '1985-01-01');
    document.getElementById('pd-termin-datum').value = '2026-08-20';
    document.getElementById('pd-termin-zeit').value = '10:00';
    document.getElementById('pd-termin-endzeit').value = '10:30';
    document.getElementById('pd-termin-art').value = 'Kontrolle';
    document.getElementById('pd-termin-arzt').innerHTML = '<option value="u1">Dr. Sarah Ahmed</option>';
    const before = window.__store.termine.length;
    bookTerminFromDetail();
    await new Promise(r => setTimeout(r, 200));
    return {
      toast: document.getElementById('toast')?.textContent || '',
      modalOpen: document.getElementById('patientDetailModal').classList.contains('show'),
      before, after: window.__store.termine.length,
    };
  });
  expect(result.toast).toContain('bereits einen');
  expect(result.modalOpen).toBe(true);
  expect(result.after).toBe(result.before);
});

test('a genuine insert failure still surfaces a real error toast afterward, not silently swallowed', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    openPatientDetail('Maria Huber', '#999', 'ÖGK', 'Adresse', '0111', '123', '1985-01-01');
    document.getElementById('pd-termin-datum').value = '2026-08-20';
    document.getElementById('pd-termin-zeit').value = '10:00';
    document.getElementById('pd-termin-endzeit').value = '10:30';
    document.getElementById('pd-termin-art').value = 'Kontrolle';
    document.getElementById('pd-termin-arzt').innerHTML = '<option value="u1">Dr. Sarah Ahmed</option>';
    window.__forceError = { termine: 'simulated DB error' };
    bookTerminFromDetail();
    // The optimistic success toast fires synchronously inside this call.
    const immediateToast = document.getElementById('toast')?.textContent || '';
    await new Promise(r => setTimeout(r, 200));
    const finalToast = document.getElementById('toast')?.textContent || '';
    delete window.__forceError;
    return { immediateToast, finalToast, termine: window.__store.termine.length };
  });
  expect(result.immediateToast).toContain('Termin gebucht');
  expect(result.finalToast).toContain('konnte nicht gespeichert werden');
  expect(result.termine).toBe(0);
});
