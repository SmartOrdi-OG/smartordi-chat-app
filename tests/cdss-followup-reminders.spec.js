// Coverage for the second CDSS slice: a non-blocking "Kontroll-Erinnerung"
// (follow-up reminder) banner in Kartei Verlauf/Stamm
// (vendor/cdss-followup-reminders.js's detectFollowupReminder(), wired via
// renderFollowupReminder() in vendor/kartei-visits.js, called from
// loadKarteiVisits()). Purely informative, computed from real visit dates
// already on file -- never blocks anything.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  }, extra);
}

async function setupPage(page, extraSeed) {
  await installMockSupabase(page, seed(extraSeed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    await patientsReady;
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    switchView('clinic');
    toggleKartei();
    switchKarteiTab('verlauf', document.querySelector('.kartei-tab'));
    await new Promise(r => setTimeout(r, 200)); // loadKarteiVisits() is fire-and-forget
  });
}

function monthsAgoISO(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

test('a diabetic patient not seen in 8 months (>6 month interval) shows a follow-up reminder', async ({ page }) => {
  await setupPage(page, {
    patient_visits: [{ id: 'v1', patient_id: 'p1', visit_date: monthsAgoISO(8), visit_type: 'Kontrolle', diagnose: 'Diabetes mellitus Typ 2', created_at: new Date().toISOString() }],
  });
  const html = await page.evaluate(() => document.getElementById('kFollowupWarnung').innerHTML);
  expect(html).toContain('Kontroll-Erinnerung');
  expect(html).toContain('Diabetes');
});

test('a diabetic patient seen 2 months ago shows no reminder yet (within the 6 month interval)', async ({ page }) => {
  await setupPage(page, {
    patient_visits: [{ id: 'v1', patient_id: 'p1', visit_date: monthsAgoISO(2), visit_type: 'Kontrolle', diagnose: 'Diabetes mellitus Typ 2', created_at: new Date().toISOString() }],
  });
  const result = await page.evaluate(() => {
    const box = document.getElementById('kFollowupWarnung');
    return { display: box.style.display, html: box.innerHTML };
  });
  expect(result.display).toBe('none');
  expect(result.html).toBe('');
});

test('a patient with no chronic-condition keyword in their history never gets a reminder, regardless of how long ago', async ({ page }) => {
  await setupPage(page, {
    patient_visits: [{ id: 'v1', patient_id: 'p1', visit_date: monthsAgoISO(24), visit_type: 'Kontrolle', diagnose: 'Grippaler Infekt', created_at: new Date().toISOString() }],
  });
  const result = await page.evaluate(() => {
    const box = document.getElementById('kFollowupWarnung');
    return { display: box.style.display, html: box.innerHTML };
  });
  expect(result.display).toBe('none');
  expect(result.html).toBe('');
});

test('a patient with no visits at all shows no reminder', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(() => {
    const box = document.getElementById('kFollowupWarnung');
    return { display: box.style.display, html: box.innerHTML };
  });
  expect(result.display).toBe('none');
});

test('switching away and back to a patient with no chronic condition clears a previously-shown reminder', async ({ page }) => {
  await setupPage(page, {
    patient_visits: [{ id: 'v1', patient_id: 'p1', visit_date: monthsAgoISO(8), visit_type: 'Kontrolle', diagnose: 'Diabetes mellitus Typ 2', created_at: new Date().toISOString() }],
  });
  const before = await page.evaluate(() => document.getElementById('kFollowupWarnung').style.display);
  expect(before).toBe('block');
  const after = await page.evaluate(async () => {
    document.getElementById('kartei-name').textContent = 'Kein Patient ausgewählt';
    await loadKarteiVisits('Kein Patient ausgewählt');
    return document.getElementById('kFollowupWarnung').style.display;
  });
  expect(after).toBe('none');
});
