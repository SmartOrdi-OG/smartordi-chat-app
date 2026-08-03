// Coverage for the first CDSS (Clinical Decision Support System) slice:
// non-blocking drug-interaction/allergy alerts on the Rezept tab
// (vendor/cdss-medication-alerts.js's detectMedicationAlerts(), wired via
// checkMedicationAlerts()/openRezeptTabForCurrentPatient() in
// vendor/kartei-rezept-ueberweisung.js). Purely informative: the doctor can
// always ignore an alert and still save/print/send the Rezept.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsPdfMock } = require('./helpers/jspdfStub');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved', allergie: 'Penicillinallergie' }],
  }, extra);
}

async function setupPage(page, extraSeed) {
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
    switchKarteiTab('rezept', document.getElementById('ktab-btn-rezept'));
    await new Promise(r => setTimeout(r, 100)); // openRezeptTabForCurrentPatient() is fire-and-forget
  });
}

test('prescribing a medication the patient is allergic to shows a non-blocking allergy alert', async ({ page }) => {
  await setupPage(page);
  const html = await page.evaluate(() => {
    document.getElementById('rz-med1').value = 'Amoxicillin 500mg';
    checkMedicationAlerts();
    return document.getElementById('rzMedAlerts').innerHTML;
  });
  expect(html).toContain('Mögliche Allergie');
  expect(html).toContain('Amoxicillin');
});

test('two NSAR-class medications together show a drug-interaction alert', async ({ page }) => {
  await setupPage(page);
  const html = await page.evaluate(() => {
    document.getElementById('rz-med1').value = 'Ibuprofen 400mg';
    document.getElementById('rz-med2').value = 'Diclofenac 50mg';
    checkMedicationAlerts();
    return document.getElementById('rzMedAlerts').innerHTML;
  });
  expect(html).toContain('Mögliche Wechselwirkung');
  expect(html).toContain('Ibuprofen');
  expect(html).toContain('Diclofenac');
});

test('unrelated medications with no known allergy show no alert and hide the box', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(() => {
    document.getElementById('rz-med1').value = 'Metformin 850mg';
    checkMedicationAlerts();
    const box = document.getElementById('rzMedAlerts');
    return { display: box.style.display, html: box.innerHTML };
  });
  expect(result.display).toBe('none');
  expect(result.html).toBe('');
});

test('an active alert never blocks building/saving the Rezept -- the doctor can always override', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('rz-med1').value = 'Amoxicillin 500mg';
    checkMedicationAlerts();
    const alertShown = document.getElementById('rzMedAlerts').style.display === 'block';
    const doc = await buildRezeptPdf();
    return { alertShown, builtOk: !!doc };
  });
  expect(result.alertShown).toBe(true);
  expect(result.builtOk).toBe(true);
});

test('clearRezeptForm() also clears any shown alert', async ({ page }) => {
  await setupPage(page);
  const display = await page.evaluate(() => {
    document.getElementById('rz-med1').value = 'Amoxicillin 500mg';
    checkMedicationAlerts();
    clearRezeptForm();
    return document.getElementById('rzMedAlerts').style.display;
  });
  expect(display).toBe('none');
});

test('a patient with no allergy on file gets no allergy alert for the same medication', async ({ page }) => {
  await setupPage(page, { patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved', allergie: '' }] });
  const html = await page.evaluate(() => {
    document.getElementById('rz-med1').value = 'Amoxicillin 500mg';
    checkMedicationAlerts();
    return document.getElementById('rzMedAlerts').innerHTML;
  });
  expect(html).not.toContain('Allergie');
});
