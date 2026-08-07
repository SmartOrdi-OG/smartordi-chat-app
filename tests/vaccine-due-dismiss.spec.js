// Regression tests for the vaccine due-reminder redesign requested
// 2026-08-07 ("شكل قايمة اللقاحات fällig ب dashboard مو عاجبتني... بدنا
// نشيلها وحتى اللقاحات المستحقين بدفتر اللقاحات بنضيف جنب اللقاح السعر
// وكمان زر اغلاق"): both doctor.html's Dashboard "Impfungen fällig" widget
// and secretary.html's matching Übersicht one were dropped entirely (both
// doctor and patient showed little real interest in that duplicate nagging
// surface); the Kartei Impfung tab's own due-list (which already had a
// price field, supabase/phase57_vaccine_dismissals.sql) gained a × button
// that hides a specific vaccine's due reminder for that patient for good.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function setupDoctorPage(page, seed) {
  await installMockSupabase(page, Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
  }, seed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
}

async function setupSecretaryPage(page, seed) {
  await installMockSupabase(page, Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
  }, seed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
}

async function openKarteiImpfung(page, name) {
  await page.evaluate(async (n) => {
    switchView('clinic'); toggleKartei();
    document.getElementById('kartei-name').textContent = n;
    switchKarteiTab('impfung');
    await new Promise(r => setTimeout(r, 100));
  }, name);
}

test('doctor.html: the Dashboard no longer shows an "Impfungen fällig" stat card or widget', async ({ page }) => {
  await setupDoctorPage(page, {
    patients: [{ id: 'p1', username: 'baby.test', full_name: 'Baby Test', name: 'Baby', versicherung: 'ÖGK', svnr: '123', dob: daysAgo(400), join_status: 'approved' }],
  });
  const state = await page.evaluate(() => ({
    statEl: !!document.getElementById('statDashImpfFaellig'),
    widgetEl: !!document.getElementById('dashImpfWarnRoot'),
    bodyHasLabel: document.body.textContent.includes('Impfungen fällig'),
  }));
  expect(state.statEl).toBe(false);
  expect(state.widgetEl).toBe(false);
  expect(state.bodyHasLabel).toBe(false);
});

test('secretary.html: the Übersicht tab no longer shows an "Impfungen fällig" widget', async ({ page }) => {
  await setupSecretaryPage(page, {
    patients: [{ id: 'p1', username: 'baby.test', full_name: 'Baby Test', name: 'Baby', versicherung: 'ÖGK', svnr: '123', dob: daysAgo(400), join_status: 'approved' }],
  });
  const state = await page.evaluate(() => ({
    widgetEl: !!document.getElementById('uebersichtImpfWarnRoot'),
    bodyHasLabel: document.body.textContent.includes('Impfungen fällig'),
  }));
  expect(state.widgetEl).toBe(false);
  expect(state.bodyHasLabel).toBe(false);
});

test('doctor.html: the Kartei Impfung tab still shows a due vaccine with a price field and a × dismiss button', async ({ page }) => {
  await setupDoctorPage(page, {
    patients: [{ id: 'p1', username: 'baby.test', full_name: 'Baby Test', name: 'Baby', versicherung: 'ÖGK', svnr: '123', dob: daysAgo(400), join_status: 'approved' }],
  });
  await openKarteiImpfung(page, 'Baby Test');
  const state = await page.evaluate(() => {
    const box = document.getElementById('impfpass-warnung');
    return {
      visible: box.style.display !== 'none',
      hasPriceInput: !!box.querySelector('input[placeholder="Preis"]'),
      hasDismissBtn: !!box.querySelector('button[onclick^="dismissVaccineDue"]'),
    };
  });
  expect(state.visible).toBe(true);
  expect(state.hasPriceInput).toBe(true);
  expect(state.hasDismissBtn).toBe(true);
});

// dob=daysAgo(8000) (~22 years, past VACCINE_SCHEDULE_MAX_AGE_DAYS) plus a
// single explicit-nextDue patient_impfungen row gives exactly one due entry
// -- no age-schedule noise -- so "the box empties" is unambiguous, unlike a
// real infant's dob which is typically overdue for several vaccines at once.
function singleDueVaccineSeed(patients) {
  return {
    patients,
    patient_impfungen: [{ id: 'imp1', patient_id: 'p1', vaccine_key: 'influenza', vaccine_name: 'Influenza', dose_label: 'Auffrischung', datum: daysAgo(300), next_due: daysAgo(5) }],
  };
}

test('clicking × persists a real dismissal and removes that vaccine from the due list', async ({ page }) => {
  await setupDoctorPage(page, singleDueVaccineSeed([
    { id: 'p1', username: 'adult.test', full_name: 'Adult Test', name: 'Adult', versicherung: 'ÖGK', svnr: '123', dob: daysAgo(8000), join_status: 'approved' },
  ]));
  await openKarteiImpfung(page, 'Adult Test');
  const before = await page.evaluate(() => document.getElementById('impfpass-warnung').textContent);
  expect(before).toContain('Influenza');

  await page.evaluate(async () => {
    document.querySelector('#impfpass-warnung button[onclick^="dismissVaccineDue"]').click();
    await new Promise(r => setTimeout(r, 150));
  });

  const after = await page.evaluate(() => ({
    dismissalRows: window.__store.patient_vaccine_dismissals.length,
    patientId: window.__store.patient_vaccine_dismissals[0]?.patient_id,
    boxVisible: document.getElementById('impfpass-warnung').style.display !== 'none',
  }));
  expect(after.dismissalRows).toBe(1);
  expect(after.patientId).toBe('p1');
  expect(after.boxVisible, 'the dismissed vaccine no longer shows in the due list').toBe(false);
});

test('a dismissal survives leaving and reopening the same patient\'s Kartei (reads from the cached dismissal set, not just DOM state)', async ({ page }) => {
  await setupDoctorPage(page, singleDueVaccineSeed([
    { id: 'p1', username: 'adult.test', full_name: 'Adult Test', name: 'Adult', versicherung: 'ÖGK', svnr: '123', dob: daysAgo(8000), join_status: 'approved' },
    { id: 'p2', username: 'other.patient', full_name: 'Other Patient', name: 'Other', versicherung: 'ÖGK', svnr: '456', dob: daysAgo(8000), join_status: 'approved' },
  ]));
  await openKarteiImpfung(page, 'Adult Test');
  await page.evaluate(async () => {
    document.querySelector('#impfpass-warnung button[onclick^="dismissVaccineDue"]').click();
    await new Promise(r => setTimeout(r, 150));
  });

  // Switch to a different patient, then back -- populateKarteiImpfung()
  // runs fresh both times, must still respect the dismissal.
  await openKarteiImpfung(page, 'Other Patient');
  await openKarteiImpfung(page, 'Adult Test');

  const boxVisible = await page.evaluate(() => document.getElementById('impfpass-warnung').style.display !== 'none');
  expect(boxVisible).toBe(false);
});

test('a dismissal for one patient does not hide the same vaccine for a different patient', async ({ page }) => {
  await setupDoctorPage(page, {
    patients: [
      { id: 'p1', username: 'adult.test', full_name: 'Adult Test', name: 'Adult', versicherung: 'ÖGK', svnr: '123', dob: daysAgo(8000), join_status: 'approved' },
      { id: 'p2', username: 'adult.two', full_name: 'Adult Two', name: 'Adult2', versicherung: 'ÖGK', svnr: '789', dob: daysAgo(8000), join_status: 'approved' },
    ],
    patient_impfungen: [
      { id: 'imp1', patient_id: 'p1', vaccine_key: 'influenza', vaccine_name: 'Influenza', dose_label: 'Auffrischung', datum: daysAgo(300), next_due: daysAgo(5) },
      { id: 'imp2', patient_id: 'p2', vaccine_key: 'influenza', vaccine_name: 'Influenza', dose_label: 'Auffrischung', datum: daysAgo(300), next_due: daysAgo(5) },
    ],
  });
  await openKarteiImpfung(page, 'Adult Test');
  await page.evaluate(async () => {
    document.querySelector('#impfpass-warnung button[onclick^="dismissVaccineDue"]').click();
    await new Promise(r => setTimeout(r, 150));
  });

  await openKarteiImpfung(page, 'Adult Two');
  const boxVisible = await page.evaluate(() => document.getElementById('impfpass-warnung').style.display !== 'none');
  expect(boxVisible, "a different patient's own reminder for the same vaccine must still show").toBe(true);
});

test('renderImpfEintrag() (vaccination history list) escapes a malicious vaccine name instead of executing it', async ({ page }) => {
  const XSS_VACCINE = 'Grippe<img src=x onerror=window.__xssFired=true>';
  await setupDoctorPage(page, {});
  await page.evaluate(() => { window.__xssFired = false; });
  const result = await page.evaluate((payload) => {
    const html = renderImpfEintrag({ vaccineName: payload, doseLabel: 'D1', datum: '2026-01-01', charge: payload });
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root);
    return {
      hasRawImgTag: /<img[^>]*onerror/.test(root.innerHTML),
      hasEscapedText: root.innerHTML.includes('&lt;img'),
    };
  }, XSS_VACCINE);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__xssFired)).toBe(false);
  expect(result.hasRawImgTag).toBe(false);
  expect(result.hasEscapedText).toBe(true);
});

// Real user report (2026-08-07, with a screenshot): the red "Einige Daten
// (z.B. Patientenliste) konnten nicht geladen werden" banner showed up right
// after being handed supabase/phase57_vaccine_dismissals.sql to run -- most
// likely refreshVaccineDismissals() hitting the table before the migration
// had actually been applied yet. That's a purely cosmetic feature failing
// (a previously-dismissed reminder just reappears), so it must NOT trip the
// same alarming banner a genuine patients/termine/messages failure does.
test('doctor.html: a failed refreshVaccineDismissals() does not show the critical data-load banner', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
    window.__forceError = { patient_vaccine_dismissals: 'relation "patient_vaccine_dismissals" does not exist' };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const bannerVisible = await page.evaluate(() => getComputedStyle(document.getElementById('dataLoadErrorBanner')).display !== 'none');
  expect(bannerVisible, 'a missing/failing vaccine-dismissals table must not look like a real patient-data failure').toBe(false);
});
