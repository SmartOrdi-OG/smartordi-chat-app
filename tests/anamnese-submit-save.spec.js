// Regression test for patient-login.html's submitAnamnese(): the mandatory
// first-login Anamnese screen called patientSetAnamnese() (which never
// throws on an RPC error -- see vendor/patient-portal-data.js, it just logs
// and returns false) without checking the result, then unconditionally
// redirected to patient.html. A real save failure was invisible -- no error
// shown at all, and the patient was navigated away with nothing persisted
// server-side (so a doctor would see no medical history on file).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed() {
  return {
    practice_settings: [{ id: true }],
    patients: [{
      id: 'p1', username: 'fatima', full_name: 'Fatima Mohammed', name: 'Fatima',
      fach: 'Allgemeinmedizin', join_status: 'approved', first_login: false, anamnese: null,
      versicherung: 'ÖGK', svnr: '1234567890', dob: '1990-05-12',
    }],
  };
}

async function loginToAnamneseScreen(page) {
  await installMockSupabase(page, seed(), () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  page.on('dialog', d => d.dismiss());
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    sb.rpc = (name) => {
      const p = window.__store.patients.find(x => x.id === 'p1');
      if (name === 'patient_login') {
        return Promise.resolve({ data: [{ token: 'tok-p1', full_name: p.full_name, name: p.name, first_login: p.first_login, join_status: p.join_status, join_note: null, anamnese: p.anamnese }], error: null });
      }
      if (name === 'check_join_request_status') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
  });
  await page.fill('#username', 'fatima');
  await page.fill('#password', 'demo123');
  await page.click('#loginBtn');
  await page.waitForTimeout(1000);
}

test('a genuine RPC error shows a failure message and does not navigate away or lose the answers', async ({ page }) => {
  await loginToAnamneseScreen(page);
  await page.evaluate(() => {
    sb.rpc = (name) => name === 'patient_set_anamnese'
      ? Promise.resolve({ data: null, error: { message: 'simulated RPC error' } })
      : Promise.resolve({ data: null, error: null });
  });
  const result = await page.evaluate(async () => {
    const cb = document.querySelector('[data-key="an.common.allergie.penizillin"]');
    if (cb) cb.checked = true;
    await submitAnamnese();
    return {
      errorShown: document.getElementById('anamneseErrorMsg').classList.contains('show'),
      errorText: document.getElementById('anamneseErrorText').textContent,
      stillOnAnamnese: document.getElementById('screen-anamnese').classList.contains('active'),
      serverAnamnese: window.__store.patients.find(p => p.id === 'p1').anamnese,
    };
  });
  expect(result.errorShown).toBe(true);
  expect(result.errorText).not.toContain('✓');
  expect(result.stillOnAnamnese, 'must not navigate to patient.html on a real save failure').toBe(true);
  expect(result.serverAnamnese).toBeFalsy();
});

test('a successful save shows no error and actually persists before moving on', async ({ page }) => {
  await loginToAnamneseScreen(page);
  await page.evaluate(() => {
    sb.rpc = (name, args) => {
      if (name === 'patient_set_anamnese') {
        window.__store.patients.find(p => p.id === 'p1').anamnese = args.p_data;
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
  });
  const result = await page.evaluate(async () => {
    const cb = document.querySelector('[data-key="an.common.allergie.penizillin"]');
    if (cb) cb.checked = true;
    await submitAnamnese();
    return {
      errorShown: document.getElementById('anamneseErrorMsg').classList.contains('show'),
      serverAnamnese: window.__store.patients.find(p => p.id === 'p1').anamnese,
    };
  });
  expect(result.errorShown).toBe(false);
  expect(result.serverAnamnese).toBeTruthy();
});
