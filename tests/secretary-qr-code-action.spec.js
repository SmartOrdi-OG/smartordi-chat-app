// New feature, on request ("بدي زر على aktionen اسمه QR Code / بضغط عليه
// بطلعلي اختر مريض بفوت بختار مريض / وبكبس طباعة او عرض الكود وبيعمل لمريض
// scannen"): a "QR-Code" entry in secretary.html's "☰ Aktionen" dropdown
// (Patienten view) opens a patient picker; choosing a patient generates a
// fresh login QR for them (reusing #patientCredentialsModal, the same modal
// "+ Neuer Patient" already populates) without going through the full
// "Patient anlegen" form. Works whether the patient already has login
// credentials or not -- selectQrPatient() always issues a new temp password,
// since a real (already-chosen-by-the-patient) password is never stored in
// plaintext to redisplay.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
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
  await page.evaluate(async () => { await Promise.all([patientsReady]); switchView('patienten'); });
}

test('the Aktionen dropdown has a "QR-Code" entry that opens the patient picker', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', join_status: 'approved' }],
  });
  await page.click('button.patient-actions-toggle[onclick*="patientActionsMenu"]');
  await page.click('#patientActionsMenu >> text=QR-Code');
  const modalOpen = await page.evaluate(() => document.getElementById('qrPatientPickerModal').classList.contains('show'));
  expect(modalOpen).toBe(true);
});

test('searching and picking a patient shows a QR code with their username, and provisions their Auth user with a fresh password', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', join_status: 'approved' }],
  });
  await page.evaluate(async () => {
    window.__authCalls = [];
    sb.functions.invoke = async (name, opts) => { window.__authCalls.push({ name, opts }); return { data: { ok: true }, error: null }; };
  });
  await page.click('button.patient-actions-toggle[onclick*="patientActionsMenu"]');
  await page.click('#patientActionsMenu >> text=QR-Code');
  await page.fill('#qrPatientSearchInput', 'Maria');
  await page.waitForTimeout(400); // 250ms debounce inside qrPatientSearch()
  await page.click('.qr-patient-row');

  const result = await page.evaluate(() => ({
    credModalOpen: document.getElementById('patientCredentialsModal').classList.contains('show'),
    pickerClosed: !document.getElementById('qrPatientPickerModal').classList.contains('show'),
    credName: document.getElementById('credName').textContent,
    credUsername: document.getElementById('credUsername').textContent,
    credPassword: document.getElementById('credPassword').textContent,
    qrSrc: document.getElementById('credQrImg').src,
    authCalls: window.__authCalls,
  }));
  expect(result.credModalOpen).toBe(true);
  expect(result.pickerClosed).toBe(true);
  expect(result.credName).toBe('Maria Huber');
  expect(result.credUsername).toBe('maria.huber');
  expect(result.credPassword.length).toBeGreaterThan(0);
  expect(result.qrSrc).toContain('data:image');
  expect(result.authCalls).toHaveLength(1);
  expect(result.authCalls[0].opts.body.kind).toBe('patient');
  expect(result.authCalls[0].opts.body.id).toBe('p1');
  expect(result.authCalls[0].opts.body.password).toBe(result.credPassword);
});

test('picking a patient who already has real login credentials still works (resets their password rather than failing)', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'karl.gruber', full_name: 'Karl Gruber', name: 'Karl', versicherung: 'BVAEB', join_status: 'approved', auth_user_id: 'existing-auth-id' }],
  });
  await page.evaluate(async () => {
    window.__authCalls = [];
    sb.functions.invoke = async (name, opts) => { window.__authCalls.push({ name, opts }); return { data: { ok: true }, error: null }; };
  });
  await page.click('button.patient-actions-toggle[onclick*="patientActionsMenu"]');
  await page.click('#patientActionsMenu >> text=QR-Code');
  await page.fill('#qrPatientSearchInput', 'Karl');
  await page.waitForTimeout(400);
  await page.click('.qr-patient-row');

  const result = await page.evaluate(() => ({
    credModalOpen: document.getElementById('patientCredentialsModal').classList.contains('show'),
    credUsername: document.getElementById('credUsername').textContent,
    authCalls: window.__authCalls,
  }));
  expect(result.credModalOpen).toBe(true);
  expect(result.credUsername).toBe('karl.gruber');
  expect(result.authCalls).toHaveLength(1);
});

test('the picker shows "Keine Treffer" for a search that matches no patient', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', join_status: 'approved' }],
  });
  await page.click('button.patient-actions-toggle[onclick*="patientActionsMenu"]');
  await page.click('#patientActionsMenu >> text=QR-Code');
  await page.fill('#qrPatientSearchInput', 'Zzzznotfound');
  await page.waitForTimeout(400);
  const text = await page.evaluate(() => document.getElementById('qrPatientSearchResults').textContent);
  expect(text).toContain('Keine Treffer');
});
