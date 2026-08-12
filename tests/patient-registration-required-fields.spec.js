// Real user feedback (2026-08-12, after a full walkthrough test): a
// patient's Geburtsdatum/Telefon/Adresse were showing up empty on real
// accounts. secretary.html's "+ Neuer Patient" modal already had
// Geburtsdatum/Telefon fields (patients.dob/tel already existed) -- they
// were just optional. patient-login.html's own self-registration form
// never asked for Geburtsdatum/Telefon at all. Both entry points now
// require Adresse + Geburtsdatum + Telefon, and self-registration carries
// dob/tel all the way through to the patients row on approval
// (supabase/phase67_join_request_dob_tel_required.sql).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('secretary.html: "+ Neuer Patient" refuses to save without Adresse, Geburtsdatum or Telefon', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    openNewPatientModal();
    document.getElementById('npVorname').value = 'Tom';
    document.getElementById('npNachname').value = 'Huber';
    // Adresse/Geburtsdatum/Telefon deliberately left empty.
    await confirmNewPatient();
    await new Promise(r => setTimeout(r, 100));
    return {
      toastText: document.getElementById('toast')?.textContent || '',
      created: window.__store.patients.some(p => p.full_name === 'Tom Huber'),
      credModalOpen: document.getElementById('patientCredentialsModal').classList.contains('show'),
    };
  });
  expect(result.toastText).toContain('Adresse');
  expect(result.created, 'no patient row should be created until the required fields are filled in').toBe(false);
  expect(result.credModalOpen).toBe(false);
});

test('secretary.html: "+ Neuer Patient" saves Geburtsdatum and Telefon once all required fields are filled', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    openNewPatientModal();
    document.getElementById('npVorname').value = 'Tom';
    document.getElementById('npNachname').value = 'Huber';
    document.getElementById('npAdresse').value = 'Teststr. 1, 1010 Wien';
    document.getElementById('npGeburtsdatum').value = '2018-01-01';
    document.getElementById('npTelefon').value = '+43 1 2345678';
    await confirmNewPatient();
    await new Promise(r => setTimeout(r, 100));
    return window.__store.patients.find(p => p.full_name === 'Tom Huber');
  });
  expect(result).toBeTruthy();
  expect(result.dob).toBe('2018-01-01');
  expect(result.tel).toBe('+43 1 2345678');
});

async function gotoFreshRegistration(page) {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html') + '?patient-register=1');
  await page.waitForTimeout(800);
}

test('patient-login.html: self-registration refuses to submit without Geburtsdatum or Telefon', async ({ page }) => {
  await gotoFreshRegistration(page);
  const result = await page.evaluate(async () => {
    document.getElementById('reqVorname').value = 'Max';
    document.getElementById('reqNachname').value = 'Mustermann';
    document.getElementById('reqAdresse').value = 'Teststr. 1, 1010 Wien';
    document.getElementById('reqSvnr').value = '1234010180';
    document.getElementById('reqUsername').value = 'maxmustermann-req';
    document.getElementById('reqPassword').value = 'geheim123';
    document.getElementById('reqConfirmPw').value = 'geheim123';
    document.getElementById('reqAgb').checked = true;
    // reqDob/reqTel deliberately left empty.
    await submitJoinRequest();
    return {
      errorShown: document.getElementById('reqErrorMsg').classList.contains('show'),
      requests: window.__store.patient_join_requests,
    };
  });
  expect(result.errorShown).toBe(true);
  expect(result.requests).toHaveLength(0);
});

test('patient-login.html: self-registration carries dob/tel through to the submitted request', async ({ page }) => {
  await gotoFreshRegistration(page);
  await page.evaluate(async () => {
    document.getElementById('reqVorname').value = 'Max';
    document.getElementById('reqNachname').value = 'Mustermann';
    document.getElementById('reqDob').value = '1985-06-15';
    document.getElementById('reqTel').value = '+43 1 9998888';
    document.getElementById('reqAdresse').value = 'Teststr. 1, 1010 Wien';
    document.getElementById('reqSvnr').value = '1234010180';
    document.getElementById('reqUsername').value = 'maxmustermann-req2';
    document.getElementById('reqPassword').value = 'geheim123';
    document.getElementById('reqConfirmPw').value = 'geheim123';
    document.getElementById('reqAgb').checked = true;
    await submitJoinRequest();
  });
  const requests = await page.evaluate(() => window.__store.patient_join_requests);
  expect(requests).toHaveLength(1);
  expect(requests[0].dob).toBe('1985-06-15');
  expect(requests[0].tel).toBe('+43 1 9998888');
});

test('secretary.html: approving a self-registration copies its dob/tel onto the resulting patients row', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patient_join_requests: [{
      id: 'jr1', username: 'maxmustermann-req2', vorname: 'Max', nachname: 'Mustermann', full_name: 'Max Mustermann',
      dob: '1985-06-15', tel: '+43 1 9998888', adresse: 'Teststr. 1, 1010 Wien', svnr: '1234010180',
      pw_hash: 'h1', status: 'pending', submitted_at: '2026-08-01T10:00:00Z',
    }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  const approved = await page.evaluate(async () => {
    await approveJoinRequest('maxmustermann-req2');
    await new Promise(r => setTimeout(r, 200));
    return window.__store.patients.find(p => p.username === 'maxmustermann-req2');
  });
  expect(approved).toBeTruthy();
  expect(approved.dob).toBe('1985-06-15');
  expect(approved.tel).toBe('+43 1 9998888');
});
