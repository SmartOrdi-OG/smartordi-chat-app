// Real user request (2026-08-19, supabase/phase74_versicherung_and_add_
// profile_dob.sql): self-registration (patient-login.html) never asked for
// a Versicherung (insurance provider) at all -- secretary.html's own "+
// Neuer Patient" already has this as a dropdown (ÖGK/BVAEB/SVS/Andere,
// Austria's real statutory funds); matched exactly here. Optional, same
// treatment as SVNr -- never enforced as required. The sibling change in
// the same migration (Geburtsdatum on "+ Kind hinzufügen") is covered in
// tests/patient-profiles.spec.js, right alongside the rest of that modal's
// coverage.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function gotoFreshRegistration(page) {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html') + '?patient-register=1');
  await page.waitForTimeout(800);
}

test('patient-login.html: self-registration carries the chosen Versicherung through to the submitted request', async ({ page }) => {
  await gotoFreshRegistration(page);
  await page.evaluate(async () => {
    document.getElementById('reqVorname').value = 'Max';
    document.getElementById('reqNachname').value = 'Mustermann';
    document.getElementById('reqDob').value = '1985-06-15';
    document.getElementById('reqTel').value = '+43 1 9998888';
    document.getElementById('reqAdresse').value = 'Teststr. 1, 1010 Wien';
    document.getElementById('reqSvnr').value = '1234010180';
    document.getElementById('reqVersicherung').value = 'BVAEB';
    document.getElementById('reqUsername').value = 'versicherung1';
    document.getElementById('reqPassword').value = 'geheim123';
    document.getElementById('reqConfirmPw').value = 'geheim123';
    document.getElementById('reqAgb').checked = true;
    await submitJoinRequest();
  });
  const requests = await page.evaluate(() => window.__store.patient_join_requests);
  expect(requests).toHaveLength(1);
  expect(requests[0].versicherung).toBe('BVAEB');
});

test('patient-login.html: self-registration submits null (not empty string) when Versicherung is left at "Keine Angabe"', async ({ page }) => {
  await gotoFreshRegistration(page);
  await page.evaluate(async () => {
    document.getElementById('reqVorname').value = 'Max';
    document.getElementById('reqNachname').value = 'Mustermann';
    document.getElementById('reqDob').value = '1985-06-15';
    document.getElementById('reqTel').value = '+43 1 9998888';
    document.getElementById('reqAdresse').value = 'Teststr. 1, 1010 Wien';
    document.getElementById('reqSvnr').value = '1234010180';
    // reqVersicherung deliberately left untouched (defaults to "").
    document.getElementById('reqUsername').value = 'versicherung2';
    document.getElementById('reqPassword').value = 'geheim123';
    document.getElementById('reqConfirmPw').value = 'geheim123';
    document.getElementById('reqAgb').checked = true;
    await submitJoinRequest();
  });
  const requests = await page.evaluate(() => window.__store.patient_join_requests);
  expect(requests).toHaveLength(1);
  expect(requests[0].versicherung).toBeFalsy();
});

test('patient-login.html: Versicherung is never required -- submission still succeeds without it', async ({ page }) => {
  await gotoFreshRegistration(page);
  const result = await page.evaluate(async () => {
    document.getElementById('reqVorname').value = 'Max';
    document.getElementById('reqNachname').value = 'Mustermann';
    document.getElementById('reqDob').value = '1985-06-15';
    document.getElementById('reqTel').value = '+43 1 9998888';
    document.getElementById('reqAdresse').value = 'Teststr. 1, 1010 Wien';
    document.getElementById('reqSvnr').value = '1234010180';
    document.getElementById('reqUsername').value = 'versicherung3';
    document.getElementById('reqPassword').value = 'geheim123';
    document.getElementById('reqConfirmPw').value = 'geheim123';
    document.getElementById('reqAgb').checked = true;
    await submitJoinRequest();
    return { errorShown: document.getElementById('reqErrorMsg').classList.contains('show') };
  });
  expect(result.errorShown).toBe(false);
  const requests = await page.evaluate(() => window.__store.patient_join_requests);
  expect(requests).toHaveLength(1);
});

test('secretary.html: approving a self-registration copies its Versicherung onto the resulting patients row', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patient_join_requests: [{
      id: 'jr1', username: 'versicherung-approve', vorname: 'Max', nachname: 'Mustermann', full_name: 'Max Mustermann',
      dob: '1985-06-15', tel: '+43 1 9998888', adresse: 'Teststr. 1, 1010 Wien', svnr: '1234010180',
      versicherung: 'SVS', pw_hash: 'h1', status: 'pending', submitted_at: '2026-08-01T10:00:00Z',
    }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  const approved = await page.evaluate(async () => {
    await approveJoinRequest('versicherung-approve');
    await new Promise(r => setTimeout(r, 200));
    return window.__store.patients.find(p => p.username === 'versicherung-approve');
  });
  expect(approved).toBeTruthy();
  expect(approved.versicherung).toBe('SVS');
});
