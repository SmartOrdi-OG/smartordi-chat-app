// Regression test for the vaccination-schedule logic in doctor.html --
// dueVaccinationsForPatient() (the "⚠ Fällige Impfungen" warning that both
// the Impfpass tab and the dashboard's due-list depend on) had no test
// coverage despite encoding Austria's whole Kinderimpfprogramm schedule.
// Also covers addImpfung()'s own validation before it ever writes a row.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function daysAhead(n) { return daysAgo(-n); }

async function setupPage(page, seed) {
  await installMockSupabase(page, Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
  }, seed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1000);
}

test('flags an age-appropriate vaccine as due once its scheduled day is reached, but not ones still too young', async ({ page }) => {
  await setupPage(page);
  // Rotavirus D1 is due at day 42, 6-fach/Pneumokokken D1 not until day 90 --
  // a 50-day-old with zero recorded vaccinations should show only Rotavirus.
  const due = await page.evaluate((dob) => dueVaccinationsForPatient('Baby Test', dob, []), daysAgo(50));
  expect(due.some(d => d.vaccine.includes('Rotavirus (D1)'))).toBe(true);
  expect(due.some(d => d.vaccine.includes('6-fach'))).toBe(false);
  expect(due.some(d => d.vaccine.includes('Pneumokokken'))).toBe(false);
});

test('does not re-flag a dose already recorded -- only the next undone one', async ({ page }) => {
  await setupPage(page);
  const dob = daysAgo(50);
  const impfungen = [{ vaccineKey: 'rotavirus', vaccineName: 'Rotavirus', datum: daysAgo(20), nextDue: null }];
  const due = await page.evaluate(({ dob, impfungen }) => dueVaccinationsForPatient('Baby Test', dob, impfungen), { dob, impfungen });
  // D1 already given; D2's threshold (day 70) isn't reached yet at day 50.
  expect(due.some(d => d.vaccine.includes('Rotavirus'))).toBe(false);
});

test('a long-overdue schedule dose is flagged "ueberfaellig", not just "faellig"', async ({ page }) => {
  await setupPage(page);
  // 400 days old, zero vaccinations -- 6-fach D1 (minDay 90) is over 30 days
  // overdue by a wide margin.
  const due = await page.evaluate((dob) => dueVaccinationsForPatient('Baby Test', dob, []), daysAgo(400));
  const sechsfach = due.find(d => d.vaccine.includes('6-fach'));
  expect(sechsfach).toBeTruthy();
  expect(sechsfach.status).toBe('ueberfaellig');
});

test('an explicit nextDue date is reported correctly and the age-based schedule stops guessing past 18', async ({ page }) => {
  await setupPage(page);
  // ~22 years old -- well past VACCINE_SCHEDULE_MAX_AGE_DAYS (6570 days), so
  // no schedule-guessed entries should appear at all; only the explicit one.
  const dob = daysAgo(8000);
  const impfungen = [{ vaccineKey: 'influenza', vaccineName: 'Influenza', datum: daysAgo(300), nextDue: daysAhead(10) }];
  const due = await page.evaluate(({ dob, impfungen }) => dueVaccinationsForPatient('Adult Test', dob, impfungen), { dob, impfungen });
  expect(due).toHaveLength(1);
  expect(due[0].vaccine).toBe('Influenza');
  expect(due[0].status).toBe('faellig');
  expect(due[0].detail).toContain('in 10 Tag(en)');
});

test('an overdue explicit nextDue date is reported as ueberfaellig with the correct day count', async ({ page }) => {
  await setupPage(page);
  const dob = daysAgo(8000);
  const impfungen = [{ vaccineKey: 'fsme', vaccineName: 'FSME (Zecken-Impfung)', datum: daysAgo(1000), nextDue: daysAgo(5) }];
  const due = await page.evaluate(({ dob, impfungen }) => dueVaccinationsForPatient('Adult Test', dob, impfungen), { dob, impfungen });
  expect(due).toHaveLength(1);
  expect(due[0].status).toBe('ueberfaellig');
  expect(due[0].detail).toContain('seit 5 Tag(en) überfällig');
});

test('addImpfung() requires a date and a real patient account before saving anything', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'baby.test', full_name: 'Baby Test', name: 'Baby', versicherung: 'ÖGK', svnr: '123', dob: daysAgo(50), join_status: 'approved' }],
  });
  const alerts = [];
  page.on('dialog', d => { alerts.push(d.message()); d.accept(); });

  await page.evaluate(async () => {
    switchView('clinic'); toggleKartei();
    document.getElementById('kartei-name').textContent = 'Baby Test';
    switchKarteiTab('impfung');
  });

  // Missing date.
  await page.evaluate(async () => {
    document.getElementById('impf-datum').value = '';
    await addImpfung();
  });
  expect(alerts.pop()).toContain('Datum eingeben');
  expect((await page.evaluate(() => window.__store.patient_impfungen.length))).toBe(0);

  // Valid date, but a patient with no real Supabase account.
  await page.evaluate(async () => {
    document.getElementById('kartei-name').textContent = 'Ghost Patient';
    document.getElementById('impf-datum').value = new Date().toISOString().slice(0, 10);
    await addImpfung();
  });
  expect(alerts.pop()).toContain('kein Cloud-Konto');
  expect((await page.evaluate(() => window.__store.patient_impfungen.length))).toBe(0);
});

test('addImpfung() saves a valid entry for a real patient', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'baby.test', full_name: 'Baby Test', name: 'Baby', versicherung: 'ÖGK', svnr: '123', dob: daysAgo(50), join_status: 'approved' }],
  });
  await page.evaluate(async () => {
    switchView('clinic'); toggleKartei();
    document.getElementById('kartei-name').textContent = 'Baby Test';
    switchKarteiTab('impfung');
  });
  const result = await page.evaluate(async () => {
    document.getElementById('impf-name').value = 'Rotavirus';
    document.getElementById('impf-datum').value = new Date().toISOString().slice(0, 10);
    document.getElementById('impf-dosis').value = 'D1';
    await addImpfung();
    await new Promise(r => setTimeout(r, 100));
    return window.__store.patient_impfungen[0];
  });
  expect(result.patient_id).toBe('p1');
  expect(result.vaccine_name).toBe('Rotavirus');
  expect(result.uploaded_by).toBe('dr.ahmed');
});
