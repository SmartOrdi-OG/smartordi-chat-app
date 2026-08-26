// Coverage for the "Cave" feature (supabase/phase80_patient_cave.sql): an
// always-shown, doctor-editable, patient-specific clinical warning note --
// distinct from the drug-keyword-matched CDSS alerts (tests/cdss-medication-
// alerts.spec.js) and from the CSV/ENDS1-import-only `allergie` field. Real
// gap found via competitor-forum research (tomedo forum.tomedo.de, see
// TODO.md): the existing CDSS had no general "always flag this patient"
// mechanism independent of what's being prescribed.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsPdfMock } = require('./helpers/jspdfStub');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  }, extra);
}

async function setupKartei(page, extraSeed) {
  await installJsPdfMock(page);
  await installMockSupabase(page, seed(extraSeed), () => {
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
    populateKarteiStamm('Maria Huber');
  });
}

test('a patient with no Cave note shows no alert and no note in the editor', async ({ page }) => {
  await setupKartei(page);
  const result = await page.evaluate(() => ({
    display: document.getElementById('k-stamm-cave').style.display,
    text: document.getElementById('k-stamm-cave').textContent,
  }));
  expect(result.display).toBe('none');
  expect(result.text).toBe('');
});

test('a patient with an existing Cave note shows it in the always-visible Stammdaten alert', async ({ page }) => {
  await setupKartei(page, { patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved', cave: 'Patient reagiert aggressiv' }] });
  const result = await page.evaluate(() => ({
    display: document.getElementById('k-stamm-cave').style.display,
    text: document.getElementById('k-stamm-cave').textContent,
  }));
  expect(result.display).toBe('flex');
  expect(result.text).toContain('Patient reagiert aggressiv');
});

test('opening the editor pre-fills the existing note, and saving persists it and updates the alert', async ({ page }) => {
  await setupKartei(page, { patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved', cave: 'Alte Notiz' }] });
  const preFilled = await page.evaluate(() => {
    openCaveEditor();
    return document.getElementById('k-cave-input').value;
  });
  expect(preFilled).toBe('Alte Notiz');

  const result = await page.evaluate(async () => {
    document.getElementById('k-cave-input').value = 'Hoergeraet, laut ansprechen';
    await saveCaveNote();
    return {
      stored: window.__store.patients.find(p => p.username === 'maria.huber').cave,
      alertText: document.getElementById('k-stamm-cave').textContent,
      editorHidden: document.getElementById('k-cave-editor').style.display === 'none',
    };
  });
  expect(result.stored).toBe('Hoergeraet, laut ansprechen');
  expect(result.alertText).toContain('Hoergeraet, laut ansprechen');
  expect(result.editorHidden).toBe(true);
});

test('clearing the note (saving empty text) hides the alert again', async ({ page }) => {
  await setupKartei(page, { patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved', cave: 'Alte Notiz' }] });
  const result = await page.evaluate(async () => {
    openCaveEditor();
    document.getElementById('k-cave-input').value = '  ';
    await saveCaveNote();
    return {
      stored: window.__store.patients.find(p => p.username === 'maria.huber').cave,
      display: document.getElementById('k-stamm-cave').style.display,
    };
  });
  expect(result.stored).toBeNull();
  expect(result.display).toBe('none');
});

test('cancelling the editor discards unsaved changes', async ({ page }) => {
  await setupKartei(page, { patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved', cave: 'Alte Notiz' }] });
  const result = await page.evaluate(() => {
    openCaveEditor();
    document.getElementById('k-cave-input').value = 'Sollte nicht gespeichert werden';
    closeCaveEditor();
    return {
      stored: window.__store.patients.find(p => p.username === 'maria.huber').cave,
      editorHidden: document.getElementById('k-cave-editor').style.display === 'none',
    };
  });
  expect(result.stored).toBe('Alte Notiz');
  expect(result.editorHidden).toBe(true);
});

test('the Rezept tab shows an unconditional Cave banner regardless of the medication typed', async ({ page }) => {
  await setupKartei(page, { patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved', cave: 'Patient reagiert aggressiv' }] });
  const result = await page.evaluate(async () => {
    switchKarteiTab('rezept', document.getElementById('ktab-btn-rezept'));
    await new Promise(r => setTimeout(r, 100));
    document.getElementById('rz-med1').value = 'Metformin 850mg'; // unrelated to any CDSS keyword
    checkMedicationAlerts();
    return {
      caveDisplay: document.getElementById('rzCaveAlert').style.display,
      caveText: document.getElementById('rzCaveAlert').textContent,
      medAlertsDisplay: document.getElementById('rzMedAlerts').style.display,
    };
  });
  expect(result.caveDisplay).toBe('block');
  expect(result.caveText).toContain('Patient reagiert aggressiv');
  expect(result.medAlertsDisplay).toBe('none');
});

test('the Rezept tab shows no Cave banner for a patient without a Cave note', async ({ page }) => {
  await setupKartei(page);
  const display = await page.evaluate(async () => {
    switchKarteiTab('rezept', document.getElementById('ktab-btn-rezept'));
    await new Promise(r => setTimeout(r, 100));
    return document.getElementById('rzCaveAlert').style.display;
  });
  expect(display).toBe('none');
});
