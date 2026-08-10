// New feature, on request: a "Impfung eintragen" entry in secretary.html's
// "☰ Aktionen" dropdown (Patienten view) opens a right-side floating window
// (secVacWindow, same floating-chat-window chrome as secCalWindow/
// secFloatingChatWindow) -- pick a patient (live search, same idea as the
// "QR-Code" picker), then fill in the same vaccine form doctor.html's own
// Kartei "＋ Neue Impfung eintragen" uses, backed by the same
// addImpfungEntry() (vendor/patient-data.js). Lets office staff record a
// vaccination without a doctor having to open the patient's Kartei for it.
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

async function openPickerAndSearch(page, query) {
  await page.click('button.patient-actions-toggle[onclick*="patientActionsMenu"]');
  await page.click('#patientActionsMenu >> text=Impfung eintragen');
  await page.fill('#secVacPatientSearchInput', query);
  await page.waitForTimeout(400); // 250ms debounce inside secVacPatientSearch()
}

test('the Aktionen dropdown has an "Impfung eintragen" entry that opens the picker window', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', join_status: 'approved' }],
  });
  await page.click('button.patient-actions-toggle[onclick*="patientActionsMenu"]');
  await page.click('#patientActionsMenu >> text=Impfung eintragen');
  const state = await page.evaluate(() => ({
    windowVisible: getComputedStyle(document.getElementById('secVacWindow')).display !== 'none',
    onSearchStep: getComputedStyle(document.getElementById('secVacSearchStep')).display !== 'none',
    onFormStep: getComputedStyle(document.getElementById('secVacFormStep')).display !== 'none',
  }));
  expect(state.windowVisible).toBe(true);
  expect(state.onSearchStep).toBe(true);
  expect(state.onFormStep).toBe(false);
});

test('picking a patient moves to the vaccine form, showing their name and a pre-filled date', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', join_status: 'approved' }],
  });
  await openPickerAndSearch(page, 'Maria');
  await page.click('.qr-patient-row');
  const state = await page.evaluate(() => ({
    onSearchStep: getComputedStyle(document.getElementById('secVacSearchStep')).display !== 'none',
    onFormStep: getComputedStyle(document.getElementById('secVacFormStep')).display !== 'none',
    selectedName: document.getElementById('secVacSelectedPatient').textContent,
    datum: document.getElementById('secVacDatum').value,
  }));
  expect(state.onSearchStep).toBe(false);
  expect(state.onFormStep).toBe(true);
  expect(state.selectedName).toContain('Maria Huber');
  expect(state.datum).toBe(new Date().toISOString().slice(0, 10));
});

test('submitting a valid entry inserts it into patient_impfungen for the right patient, then closes the window', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', join_status: 'approved' }],
  });
  await openPickerAndSearch(page, 'Maria');
  await page.click('.qr-patient-row');
  await page.selectOption('#secVacName', 'Rotavirus');
  await page.selectOption('#secVacDosis', '2. Dosis');
  await page.fill('#secVacCharge', 'A12345B');
  await page.click('text=✓ Impfung speichern');
  await page.waitForTimeout(150);

  const result = await page.evaluate(() => ({
    row: window.__store.patient_impfungen[0],
    windowVisible: getComputedStyle(document.getElementById('secVacWindow')).display !== 'none',
  }));
  expect(result.row.patient_id).toBe('p1');
  expect(result.row.vaccine_name).toBe('Rotavirus');
  expect(result.row.dose_label).toBe('2. Dosis');
  expect(result.row.charge).toBe('A12345B');
  expect(result.row.uploaded_by).toBe('sek1');
  expect(result.windowVisible).toBe(false);
});

test('"Sonstige" requires a typed name and saves it as the vaccine name', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', join_status: 'approved' }],
  });
  await openPickerAndSearch(page, 'Maria');
  await page.click('.qr-patient-row');
  await page.selectOption('#secVacName', 'Sonstige');
  await page.fill('#secVacNameCustom', 'Gelbfieber');
  await page.click('text=✓ Impfung speichern');
  await page.waitForTimeout(150);
  const row = await page.evaluate(() => window.__store.patient_impfungen[0]);
  expect(row.vaccine_name).toBe('Gelbfieber');
});

test('a missing date is rejected before anything is saved', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', join_status: 'approved' }],
  });
  const alerts = [];
  page.on('dialog', d => { alerts.push(d.message()); d.accept(); });
  await openPickerAndSearch(page, 'Maria');
  await page.click('.qr-patient-row');
  await page.fill('#secVacDatum', '');
  await page.click('text=✓ Impfung speichern');
  expect(alerts.pop()).toContain('Datum eingeben');
  expect((await page.evaluate(() => window.__store.patient_impfungen.length))).toBe(0);
});

test('the picker shows "Keine Treffer" for a search that matches no patient', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', join_status: 'approved' }],
  });
  await openPickerAndSearch(page, 'Zzzznotfound');
  const text = await page.evaluate(() => document.getElementById('secVacPatientSearchResults').textContent);
  expect(text).toContain('Keine Treffer');
});

test('"‹ Anderen Patienten wählen" goes back to the search step without losing the window', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', join_status: 'approved' }],
  });
  await openPickerAndSearch(page, 'Maria');
  await page.click('.qr-patient-row');
  await page.click('text=‹ Anderen Patienten wählen');
  const state = await page.evaluate(() => ({
    windowVisible: getComputedStyle(document.getElementById('secVacWindow')).display !== 'none',
    onSearchStep: getComputedStyle(document.getElementById('secVacSearchStep')).display !== 'none',
  }));
  expect(state.windowVisible).toBe(true);
  expect(state.onSearchStep).toBe(true);
});

test('switching away from the Patienten tab closes the window', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', join_status: 'approved' }],
  });
  await page.click('button.patient-actions-toggle[onclick*="patientActionsMenu"]');
  await page.click('#patientActionsMenu >> text=Impfung eintragen');
  await page.evaluate(() => switchView('uebersicht'));
  const windowVisible = await page.evaluate(() => getComputedStyle(document.getElementById('secVacWindow')).display !== 'none');
  expect(windowVisible).toBe(false);
});
