// Regression tests for the RECEIVING doctor/Krankenhaus's own Anschrift/
// Telefon on the Überweisung form (supabase/phase52_ueberweisung_an_kontakt.sql)
// -- previously only their bare name ("an") was captured anywhere, with no
// way to persist or print how to actually reach them back. Optional (a
// doctor filling this in isn't required), so also covers that leaving both
// blank still works exactly as before.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsPdfMock } = require('./helpers/jspdfStub');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  };
}

async function setupPage(page) {
  await installJsPdfMock(page);
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    await Promise.all([patientsReady, practiceSettingsReady]);
    switchView('clinic');
    toggleKartei();
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    switchKarteiTab('ueberweisung', document.querySelector('.kartei-tab[onclick*="ueberweisung"]'));
  });
}

test('downloadUwPDF() persists the receiving doctor\'s Anschrift/Telefon when filled in', async ({ page }) => {
  await setupPage(page);
  await page.fill('#uwAn', 'Dr. Klaus Weber – Kardiologie Wien');
  await page.fill('#uwAnAdresse', 'Hauptstraße 10, 1010 Wien');
  await page.fill('#uwAnTel', '+43 1 2345678');
  const result = await page.evaluate(async () => {
    await downloadUwPDF();
    await new Promise(r => setTimeout(r, 50));
    return {
      row: window.__store.patient_ueberweisungen[0],
      adresseField: document.getElementById('uwAnAdresse').value,
      telField: document.getElementById('uwAnTel').value,
    };
  });
  expect(result.row.an_adresse).toBe('Hauptstraße 10, 1010 Wien');
  expect(result.row.an_tel).toBe('+43 1 2345678');
  expect(result.adresseField, 'the form must clear after issuing').toBe('');
  expect(result.telField).toBe('');
});

test('printUwPDF() and handleUwSend() also persist the receiving doctor\'s contact details', async ({ page }) => {
  await setupPage(page);
  await page.fill('#uwAn', 'Dr. Eva Novak – Neurologie Graz');
  await page.fill('#uwAnAdresse', 'Grazer Straße 5, 8010 Graz');
  const printResult = await page.evaluate(async () => {
    await printUwPDF();
    await new Promise(r => setTimeout(r, 50));
    return window.__store.patient_ueberweisungen[0];
  });
  expect(printResult.an_adresse).toBe('Grazer Straße 5, 8010 Graz');
  expect(printResult.an_tel, 'was left blank -- must persist as null, not a fabricated value').toBeNull();

  await page.fill('#uwAn', 'Dr. Peter Bauer – Orthopädie Linz');
  await page.fill('#uwAnTel', '+43 732 111222');
  const sendResult = await page.evaluate(async () => {
    await handleUwSend();
    await new Promise(r => setTimeout(r, 100));
    return window.__store.patient_ueberweisungen[1];
  });
  expect(sendResult.an_tel).toBe('+43 732 111222');
});

test('leaving both fields blank persists them as null, same as before this feature existed', async ({ page }) => {
  await setupPage(page);
  await page.fill('#uwAn', 'Dr. Klaus Weber – Kardiologie Wien');
  const result = await page.evaluate(async () => {
    await downloadUwPDF();
    await new Promise(r => setTimeout(r, 50));
    return window.__store.patient_ueberweisungen[0];
  });
  expect(result.an_adresse).toBeNull();
  expect(result.an_tel).toBeNull();
});

test('buildUeberweisungPdf() draws the Anschrift/Telefon box only when at least one is filled in', async ({ page }) => {
  await setupPage(page);
  const withoutContact = await page.evaluate(() => buildUeberweisungPdf()._texts.join(' | '));
  expect(withoutContact).not.toContain('Anschrift (Arzt/Krankenhaus)');

  await page.fill('#uwAnTel', '+43 1 999888');
  const withContact = await page.evaluate(() => buildUeberweisungPdf()._texts.join(' | '));
  expect(withContact).toContain('Telefon (Arzt/Krankenhaus)');
  expect(withContact).toContain('+43 1 999888');
});
