// Regression test for the real fix behind this: secretary.html's sidebar
// search box (filterPatients(), oninput on #secPatientSearchInput) used to
// only hide/show .patient-row rows already rendered from the ≤500-most-
// recently-active patient cache (loadPatients()) -- a patient outside that
// window was invisible to it, even though a live server search
// (searchPatientsServer()) already existed and was used elsewhere. This
// confirms the box itself now reaches every patient (mirrors doctor.html's
// patient-sidebar-search-live.spec.js, which covers the same fix there).
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
    practice_settings: [{ id: true, adresse: 'Steingasse 6A, 4020 Linz', tel: '+43 677 62439293', plan: 'pro' }],
    patients,
  };
}

async function setupPage(page) {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, allMessagesReady]); renderRealPatientRows(); });
}

test('typing the name of a patient outside the bounded 500 into the real search box finds them anyway', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    const inBoundedList = 'Patient Number0000' in Object.fromEntries(Object.values(loadPatients()).map(p => [p.fullName, true]));
    document.getElementById('secPatientSearchInput').value = 'Patient Number0000';
    await filterPatients('Patient Number0000');
    const found = [...document.querySelectorAll('#patientList .patient-row[data-real]')].find(el => el.textContent.includes('Patient Number0000'));
    return { inBoundedList, found: !!found };
  });
  expect(result.inBoundedList, 'sanity check: this patient really is outside the bounded list').toBe(false);
  expect(result.found, 'the search box must reach a patient outside the bounded ≤500 list').toBe(true);
});

test('clearing the search box restores the full normal list', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('secPatientSearchInput').value = 'Patient Number0000';
    await filterPatients('Patient Number0000');
    document.getElementById('secPatientSearchInput').value = '';
    await filterPatients('');
    return document.querySelectorAll('#patientList .patient-row[data-real]').length;
  });
  expect(result).toBe(500);
});
