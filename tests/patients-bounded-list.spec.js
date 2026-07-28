// Regression test for patient search-on-demand PR6 (final phase, see
// TODO.md): refreshPatients() now bounds the sidebar/dashboard/Termin-
// picker's underlying list to the PATIENTS_LIST_LIMIT most recently active
// patients instead of fetching every row unconditionally. The whole point
// of this rollout is that being outside that bounded set must NOT mean
// "unreachable" -- every patient stays fully findable via the live
// search/lookup helpers added in PR1/PR3/PR4, which always query Supabase
// directly rather than reading loadPatients().
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

const TOTAL_PATIENTS = 502;

function seed() {
  const patients = [];
  // i=0 is the OLDEST (least recently active), i=501 the most recent --
  // the 500 most recent (i=2..501) must survive the bound, i=0/1 must not.
  // updated_at is spread one real calendar day apart per row so ordering
  // is unambiguous for all 502 rows.
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
  await page.evaluate(async () => { await patientsReady; });
}

test('refreshPatients() only keeps the 500 most recently active patients, not all 502', async ({ page }) => {
  await setupPage(page);
  const size = await page.evaluate(() => Object.keys(loadPatients()).length);
  expect(size).toBe(500);
});

test('the oldest (least recently active) patients are excluded from the bounded list', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(() => {
    const list = Object.values(loadPatients());
    return {
      hasOldest: list.some(p => p.fullName === 'Patient Number0000'),
      hasSecondOldest: list.some(p => p.fullName === 'Patient Number0001'),
      hasNewest: list.some(p => p.fullName === 'Patient Number0501'),
    };
  });
  expect(result.hasOldest, 'the single oldest patient must have been dropped by the 500 cap').toBe(false);
  expect(result.hasSecondOldest, 'the second-oldest patient must also have been dropped').toBe(false);
  expect(result.hasNewest, 'the most recently active patient must be present').toBe(true);
});

test('a patient excluded from the bounded list is still fully reachable via live search/lookup', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    const inBoundedList = 'Patient Number0000' in Object.fromEntries(Object.values(loadPatients()).map(p => [p.fullName, true]));
    const viaSearch = await searchPatientsServer('Patient Number0000');
    const viaExactLookup = await findPatientByFullNameServer('Patient Number0000');
    const viaAsyncRecord = await findPatientRecordAsync('Patient Number0000');
    return { inBoundedList, viaSearch, viaExactLookup, viaAsyncRecord };
  });
  expect(result.inBoundedList, 'sanity check: this patient really is outside the bounded list').toBe(false);
  expect(result.viaSearch).toHaveLength(1);
  expect(result.viaSearch[0].fullName).toBe('Patient Number0000');
  expect(result.viaExactLookup).toBeTruthy();
  expect(result.viaExactLookup.fullName).toBe('Patient Number0000');
  expect(result.viaAsyncRecord).toBeTruthy();
  expect(result.viaAsyncRecord.name).toBe('Patient Number0000');
});
