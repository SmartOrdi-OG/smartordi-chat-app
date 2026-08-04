// Regression test: doctor.html's Kartei "Stammdaten"/"Versicherung"/
// "Medizinische Hinweise" card shipped with realistic-looking sample data
// (Träger "ÖGK", SV-Nummer "1234 010185", "Einwilligung 15.01.2026",
// Blutgruppe "A+", Diagnosen "Hypertonie, Diabetes T2", and a visible
// "Penicillin-Allergie beachten!" warning) hardcoded directly into the
// static HTML -- a real screenshot from the live app showed this exact
// fake content still on screen before any patient had ever been selected,
// alongside the (correctly empty) Name/Geburtsdatum/Telefon/Adresse/
// Sprache fields right above it. populateKarteiStamm() only ever
// overwrites these elements once a real patient is selected, so until
// then a doctor sees fabricated insurance/medical/allergy data that looks
// exactly like a real record. Every field must default to the same "—"
// placeholder as the fields beside it, and the allergy alert must default
// to hidden (same as populateKarteiStamm()'s own `p.allergie ? 'block' :
// 'none'` branch), not a permanently-visible hardcoded warning.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved', blutgruppe: 'A+', diagnosen: 'Hypertonie, Diabetes T2', allergie: 'Penicillin-Allergie' }],
  }, extra);
}

async function setupPage(page) {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await patientsReady; });
}

test('before any patient is selected, the Kartei Stammdaten/Versicherung/Medizinische-Hinweise card shows only empty placeholders, no fake sample data', async ({ page }) => {
  await setupPage(page);
  const state = await page.evaluate(() => ({
    versicherung: document.getElementById('k-stamm-versicherung').textContent,
    svnr: document.getElementById('k-stamm-svnr').textContent,
    dsgvo: document.getElementById('k-stamm-dsgvo').textContent,
    blutgruppe: document.getElementById('k-stamm-blutgruppe').textContent,
    diagnosen: document.getElementById('k-stamm-diagnosen').textContent,
    allergieVisible: document.getElementById('k-stamm-allergie').style.display !== 'none',
  }));
  expect(state.versicherung).toBe('—');
  expect(state.svnr).toBe('—');
  expect(state.dsgvo).toBe('—');
  expect(state.blutgruppe).toBe('—');
  expect(state.diagnosen).toBe('—');
  expect(state.allergieVisible, 'the allergy warning must not show before a patient with a real allergy is selected').toBe(false);
});

test('populateKarteiStamm() replaces the placeholders with the real selected patient\'s data', async ({ page }) => {
  await setupPage(page);
  const state = await page.evaluate(() => {
    populateKarteiStamm('Maria Huber');
    return {
      versicherung: document.getElementById('k-stamm-versicherung').textContent,
      svnr: document.getElementById('k-stamm-svnr').textContent,
      blutgruppe: document.getElementById('k-stamm-blutgruppe').textContent,
      diagnosen: document.getElementById('k-stamm-diagnosen').textContent,
      allergieVisible: document.getElementById('k-stamm-allergie').style.display !== 'none',
      allergieText: document.getElementById('k-stamm-allergie').textContent,
    };
  });
  expect(state.versicherung).toBe('ÖGK');
  expect(state.svnr).toBe('123');
  expect(state.blutgruppe).toBe('A+');
  expect(state.diagnosen).toBe('Hypertonie, Diabetes T2');
  expect(state.allergieVisible).toBe(true);
  expect(state.allergieText).toBe('Penicillin-Allergie');
});
