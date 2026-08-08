// Regression test for a real cross-tenant PII leak (2026-08-08): the
// browser-wide localStorage key smartordi_patient_accounts has no
// practice_id scoping at all. refreshPatients()/fetchAllPatientsUnbounded()
// (vendor/patient-data.js) used to blindly merge in ANY entry from that key
// that the current, correctly practice-scoped Supabase fetch didn't
// return -- so switching, on the same device, from one practice's staff
// login to a DIFFERENT practice's left the first practice's own cached
// patients (full name, SVNR) sitting in localStorage, and the newly
// logged-in practice's patient list silently absorbed them as if they were
// its own. Supabase/RLS itself was never at fault (the fetch was always
// correctly scoped) -- this was a purely client-side leak. Real incident:
// found live when a freshly created Pilot practice's secretary logged in
// on a device previously used for a real practice and saw that practice's
// real patients (with real SVNR) in her own sidebar.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function setupPage(page, localAccounts) {
  // installMockSupabase's extraInit runs via page.addInitScript() with no
  // argument passed through, so localAccounts (per-test, not static) has to
  // be inlined into the generated function's source instead of closed over.
  // eslint-disable-next-line no-new-func
  const extraInit = new Function(`
    sessionStorage.setItem('smartordi_user', JSON.stringify({role:'arzt',name:'Dr. Sarah Ahmed',username:'dr.ahmed',isAdmin:true}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({'dr.ahmed':{username:'dr.ahmed',fullName:'Dr. Sarah Ahmed',role:'arzt',isAdmin:true,fach:'Allgemeinmedizin'}}));
    // Simulates a DIFFERENT, real practice's leftover cache on this same
    // device/browser -- exactly what smartordi_patient_accounts looked like
    // in the real incident, keyed by a username the CURRENT practice's own
    // Supabase fetch (seeded above) never returns.
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify(${JSON.stringify(localAccounts)}));
  `);
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'pilot-practice', name: 'Pilot-Praxis', plan: 'enterprise' }],
    patients: [
      { id: 'p1', username: 'lukas.wagner', full_name: 'Lukas Wagner', name: 'Lukas', svnr: '1234 120385', join_status: 'approved' },
    ],
  }, extraInit);
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await patientsReady; });
}

test('refreshPatients() never resurrects a localStorage-only account into a different practice\'s list', async ({ page }) => {
  await setupPage(page, {
    'foreign.patient': { id: 'foreign-real-id', username: 'foreign.patient', fullName: 'Ahmad Saadat', name: 'Ahmad', svnr: '9999 999999' },
  });
  const result = await page.evaluate(() => loadPatients());
  expect(Object.keys(result)).toEqual(['lukas.wagner']);
  expect(result['foreign.patient']).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('Ahmad Saadat');
  expect(JSON.stringify(result)).not.toContain('9999 999999');
});

test('fetchAllPatientsUnbounded() (backs Vertretung/address-change broadcasts) has the same guarantee', async ({ page }) => {
  await setupPage(page, {
    'foreign.patient': { id: 'foreign-real-id', username: 'foreign.patient', fullName: 'Ahmad Saadat', name: 'Ahmad', svnr: '9999 999999' },
  });
  const result = await page.evaluate(async () => await fetchAllPatientsUnbounded());
  expect(Object.keys(result)).toEqual(['lukas.wagner']);
  expect(result['foreign.patient']).toBeUndefined();
});

test('a matched patient (real Supabase row) still gets its local-only supplemental fields filled in -- the fix only removes UNMATCHED entries', async ({ page }) => {
  await setupPage(page, {
    'lukas.wagner': { fach: 'Kinderarzt', anamnese: 'Lokal gespeicherte Anamnese' },
  });
  const result = await page.evaluate(() => loadPatients());
  expect(result['lukas.wagner'].fullName).toBe('Lukas Wagner');
  expect(result['lukas.wagner'].fach).toBe('Kinderarzt');
  expect(result['lukas.wagner'].anamnese).toBe('Lokal gespeicherte Anamnese');
});
