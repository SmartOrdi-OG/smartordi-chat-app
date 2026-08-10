// New feature, on request: an "Impfung eintragen" entry in secretary.html's
// per-patient chat header "☰ Aktionen" menu (#chatAttestActionsMenu,
// alongside Pflegefreistellung/Arbeitsunfähigkeit ausstellen) lets office
// staff record a vaccination for whichever patient's chat is currently
// open, without a doctor having to open the patient's Kartei for it.
// openImpfungFromChat() resolves the patient straight from #chatName (same
// idea as the two Attest buttons next to it) -- no separate patient-picker
// step. Same VACCINE_SCHEDULE + addImpfungEntry() (vendor/patient-data.js)
// doctor.html's own Kartei "＋ Neue Impfung eintragen" form uses.
//
// Renders as a real inline third column of .nachrichten-split (the
// "vac-open" class, #nachrichtenVacPane) -- NOT a position:fixed floating
// window -- on request ("مش صفحة عايمة... تيجي في الجزء الفاضي اللي على
// اليمين"): it fills the same real screen space .nachrichten-chat-pane's
// own max-width:760px cap already leaves empty on a wide monitor.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
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
  await page.evaluate(async () => { await Promise.all([patientsReady, allMessagesReady, termineReady]); renderRealPatientRows(); });
  await page.click('.nav-tab[data-view="patienten"]');
  await page.waitForTimeout(200);
}

async function openPatientChat(page, name) {
  await page.click(`#patientList .patient-row[data-real]:has-text("${name}")`);
  await page.waitForTimeout(300);
}

async function openVaccinePane(page) {
  await page.click('button.patient-actions-toggle[onclick*="chatAttestActionsMenu"]');
  await page.click('#chatAttestActionsMenu >> text=Impfung eintragen');
  await page.waitForTimeout(150);
}

test('the chat header Aktionen menu has an "Impfung eintragen" entry, alongside the Atteste ones', async ({ page }) => {
  await setupPage(page);
  await openPatientChat(page, 'Maria Huber');
  const menuItems = await page.evaluate(() => [...document.querySelectorAll('#chatAttestActionsMenu .rail-btn')].map(b => b.textContent.trim()));
  expect(menuItems).toEqual(['Pflegefreistellung ausstellen', 'Arbeitsunfähigkeit ausstellen', 'Impfung eintragen']);
});

test('opening it shows the inline pane (not a floating window) with the open chat\'s patient name and a pre-filled date', async ({ page }) => {
  await setupPage(page);
  await openPatientChat(page, 'Maria Huber');
  await openVaccinePane(page);
  const state = await page.evaluate(() => ({
    splitHasVacOpen: document.getElementById('nachrichtenSplit').classList.contains('vac-open'),
    paneVisible: getComputedStyle(document.getElementById('nachrichtenVacPane')).display !== 'none',
    isInlineNotFixed: getComputedStyle(document.getElementById('nachrichtenVacPane')).position !== 'fixed',
    patientLabel: document.getElementById('secVacPatientLabel').textContent,
    datum: document.getElementById('secVacDatum').value,
  }));
  expect(state.splitHasVacOpen).toBe(true);
  expect(state.paneVisible).toBe(true);
  expect(state.isInlineNotFixed).toBe(true);
  expect(state.patientLabel).toBe('Maria Huber');
  expect(state.datum).toBe(new Date().toISOString().slice(0, 10));
});

test('submitting a valid entry inserts it into patient_impfungen for the open chat\'s patient, then closes the pane', async ({ page }) => {
  await setupPage(page);
  await openPatientChat(page, 'Maria Huber');
  await openVaccinePane(page);
  await page.selectOption('#secVacName', 'Rotavirus');
  await page.selectOption('#secVacDosis', '2. Dosis');
  await page.fill('#secVacCharge', 'A12345B');
  await page.click('text=✓ Impfung speichern');
  await page.waitForTimeout(150);

  const result = await page.evaluate(() => ({
    row: window.__store.patient_impfungen[0],
    splitHasVacOpen: document.getElementById('nachrichtenSplit').classList.contains('vac-open'),
  }));
  expect(result.row.patient_id).toBe('p1');
  expect(result.row.vaccine_name).toBe('Rotavirus');
  expect(result.row.dose_label).toBe('2. Dosis');
  expect(result.row.charge).toBe('A12345B');
  expect(result.row.uploaded_by).toBe('sek1');
  expect(result.splitHasVacOpen).toBe(false);
});

test('"Sonstige" requires a typed name and saves it as the vaccine name', async ({ page }) => {
  await setupPage(page);
  await openPatientChat(page, 'Maria Huber');
  await openVaccinePane(page);
  await page.selectOption('#secVacName', 'Sonstige');
  await page.fill('#secVacNameCustom', 'Gelbfieber');
  await page.click('text=✓ Impfung speichern');
  await page.waitForTimeout(150);
  const row = await page.evaluate(() => window.__store.patient_impfungen[0]);
  expect(row.vaccine_name).toBe('Gelbfieber');
});

test('a missing date is rejected before anything is saved', async ({ page }) => {
  await setupPage(page);
  const alerts = [];
  page.on('dialog', d => { alerts.push(d.message()); d.accept(); });
  await openPatientChat(page, 'Maria Huber');
  await openVaccinePane(page);
  await page.fill('#secVacDatum', '');
  await page.click('text=✓ Impfung speichern');
  expect(alerts.pop()).toContain('Datum eingeben');
  expect((await page.evaluate(() => window.__store.patient_impfungen.length))).toBe(0);
});

test('closing the pane reveals the chat pane again, without leaving Patienten', async ({ page }) => {
  await setupPage(page);
  await openPatientChat(page, 'Maria Huber');
  await openVaccinePane(page);
  await page.click('#nachrichtenVacPane .floating-chat-close');
  const state = await page.evaluate(() => ({
    splitHasVacOpen: document.getElementById('nachrichtenSplit').classList.contains('vac-open'),
    chatPaneVisible: getComputedStyle(document.getElementById('nachrichtenChatPane')).display !== 'none',
  }));
  expect(state.splitHasVacOpen).toBe(false);
  expect(state.chatPaneVisible).toBe(true);
});

test('switching away from the Patienten tab closes the pane', async ({ page }) => {
  await setupPage(page);
  await openPatientChat(page, 'Maria Huber');
  await openVaccinePane(page);
  await page.evaluate(() => switchView('uebersicht'));
  const splitHasVacOpen = await page.evaluate(() => document.getElementById('nachrichtenSplit').classList.contains('vac-open'));
  expect(splitHasVacOpen).toBe(false);
});

test('a patient with no Cloud-Konto shows an error instead of opening the pane', async ({ page }) => {
  // Only reachable in practice if a legacy/local-only chat were somehow
  // open, but openImpfungFromChat() itself must fail closed either way --
  // simulate it by making the account lookup miss.
  await setupPage(page);
  await openPatientChat(page, 'Maria Huber');
  await page.evaluate(() => { window.findPatientAccountAsync = async () => null; });
  await page.click('button.patient-actions-toggle[onclick*="chatAttestActionsMenu"]');
  await page.click('#chatAttestActionsMenu >> text=Impfung eintragen');
  await page.waitForTimeout(150);
  const splitHasVacOpen = await page.evaluate(() => document.getElementById('nachrichtenSplit').classList.contains('vac-open'));
  expect(splitHasVacOpen).toBe(false);
});
