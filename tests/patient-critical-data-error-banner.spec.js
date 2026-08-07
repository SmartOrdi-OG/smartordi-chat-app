// Real report, with a screenshot: a real (token-backed) patient's Profil
// view showed nothing but "--" placeholders in every field (name, DOB,
// address, ...) and the Chat nav badge stuck on its hardcoded static demo
// "2" -- with zero visible indication anything was wrong. Root cause: a
// genuine patient_get_profile RPC failure was only ever console.error'd
// (vendor/patient-portal-data.js's patientGetProfile()), never surfaced --
// so initPatientData()'s `if(!account)` branch silently bailed out before
// ever touching the Profil fields. Fixed the same way doctor.html/
// secretary.html already handle a failed refreshPatients()/refreshTermine():
// reportCriticalDataError()/setCriticalDataErrorHandler() (vendor/staff-
// accounts.js), now wired up in patient.html too. Scoped to a genuine
// {error} response only -- a merely-empty-but-error-free RPC result (e.g. a
// session with legitimately no matching row yet) must NOT trip this.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function setup(page) {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria.huber' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
}

test('a failed patient_get_profile RPC shows the critical data-load banner instead of a silently blank Profil', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: null, error: { message: 'simulated RPC error' } });
      return Promise.resolve({ data: [], error: null });
    };
    await initPatientData();
    return {
      bannerDisplay: getComputedStyle(document.getElementById('dataLoadErrorBanner')).display,
      profilName: document.getElementById('profilName').textContent,
    };
  });
  expect(result.bannerDisplay).not.toBe('none');
  // The Profil field itself stays at its honest "no data" placeholder --
  // this fix is about making the failure visible, not fabricating data.
  expect(result.profilName).toBe('—');
});

test('a successful patient_get_profile RPC never shows the banner', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({
        data: [{ id: 'p1', username: 'maria.huber', name: 'Maria', full_name: 'Maria Huber', dob: '1985-01-01', adresse: null, tel: null, email: null, versicherung: null, svnr: null, first_login: false }],
        error: null,
      });
      return Promise.resolve({ data: [], error: null });
    };
    await initPatientData();
    return {
      bannerDisplay: getComputedStyle(document.getElementById('dataLoadErrorBanner')).display,
      profilName: document.getElementById('profilName').textContent,
    };
  });
  expect(result.bannerDisplay).toBe('none');
  expect(result.profilName).toBe('Maria Huber');
});

// setup()'s own page.goto() already fires one automatic initPatientData()
// call against the mock's default no-op RPC handler
// (data:null,error:null for every call, i.e. no matching profile row but
// NOT an error) before any test gets to override sb.rpc -- this must stay
// silent (no banner), or every other existing patient.html test using this
// same "goto with a token set, then override+recall" pattern would start
// failing on an unrelated leftover banner intercepting clicks.
test('a benign empty (non-error) RPC response on the automatic page-load call never trips the banner', async ({ page }) => {
  await setup(page);
  const bannerDisplay = await page.evaluate(() => getComputedStyle(document.getElementById('dataLoadErrorBanner')).display);
  expect(bannerDisplay).toBe('none');
});
