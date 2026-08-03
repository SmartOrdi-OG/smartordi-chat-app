// Regression test for the real fix behind this: doctor.html's sidebar
// search box (filterPatientsList(), oninput on #patientSearchInput) used to
// only hide/show .patient-item rows already rendered from the ≤500-most-
// recently-active patient cache (loadPatients()) -- a patient outside that
// window was invisible to it, even though a live server search
// (searchPatientsServer()) already existed and was used elsewhere. This
// confirms the box itself now reaches every patient, and that the
// Dashboard's "Patienten" stat shows the real total instead of capping at
// 500 (see patients-bounded-list.spec.js for the underlying bounded-cache
// behavior this builds on).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

const TOTAL_PATIENTS = 502;

function seed() {
  const patients = [];
  for (let i = 0; i < TOTAL_PATIENTS; i++) {
    const d = new Date('2020-01-01T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    patients.push({
      id: 'p' + i,
      username: 'patient' + i,
      full_name: 'Patient Number' + String(i).padStart(4, '0'),
      name: 'Patient',
      svnr: String(1000000000 + i),
      join_status: 'approved',
      updated_at: d.toISOString(),
    });
  }
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients,
  };
}

async function setupPage(page) {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, allMessagesReady]); });
}

test('typing the name of a patient outside the bounded 500 into the real sidebar search box finds them anyway', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    const inBoundedList = 'Patient Number0000' in Object.fromEntries(Object.values(loadPatients()).map(p => [p.fullName, true]));
    document.getElementById('patientSearchInput').value = 'Patient Number0000';
    await filterPatientsList('Patient Number0000');
    const found = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Patient Number0000'));
    return {
      inBoundedList,
      found: !!found,
      foundVisible: found ? found.style.display !== 'none' : null,
    };
  });
  expect(result.inBoundedList, 'sanity check: this patient really is outside the bounded list').toBe(false);
  expect(result.found, 'the sidebar search box must reach a patient outside the bounded ≤500 list').toBe(true);
  expect(result.foundVisible).toBe(true);
});

test('a match already shown in "Heute" is not duplicated into the search results', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    // The single most-recently-active patient (i=501) also has a Termin
    // today -- searching their own name must not show them twice (once
    // under "Heute", once under the search results replacing "Alle
    // Patienten").
    const name = 'Patient Number0501';
    window.__store.termine.push({ id: 't1', patient_name: name, arzt_username: 'dr.ahmed', date: todayStr(), time: '10:00', status: 'bestätigt' });
    await refreshTermine();
    renderPatientList();
    document.getElementById('patientSearchInput').value = name;
    await filterPatientsList(name);
    const matches = [...document.querySelectorAll('.patient-item')].filter(el => el.textContent.includes(name));
    return { matchCount: matches.length };
  });
  expect(result.matchCount).toBe(1);
});

test('the Dashboard "Patienten" stat shows the real total, not the bounded 500-patient cap', async ({ page }) => {
  await setupPage(page);
  const count = await page.evaluate(async () => {
    updateDashboardStats();
    await countAllPatients(); // make sure the underlying query itself resolves before polling the DOM
    return new Promise(resolve => {
      const check = () => {
        const text = document.getElementById('statDashPatients').textContent;
        if (text === String(502)) return resolve(text);
        setTimeout(check, 20);
      };
      check();
    });
  });
  expect(count).toBe(String(TOTAL_PATIENTS));
});
