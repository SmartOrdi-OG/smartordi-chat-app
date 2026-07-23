// Regression test for supabase/phase28_guardian_child_accounts.sql's
// guardian-facing login flow in patient-login.html: guardianLogin() ->
// (first login only) change password -> child picker -> guardianSelectChild()
// mints an ordinary patient session token for the chosen child. From that
// point on patient.html should treat the session exactly like a real direct
// patient login -- this test only covers up through the token/session hand-
// off, not patient.html itself (already covered by its own test suite).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function guardianRow(overrides) {
  return Object.assign({
    id: 'g1', username: 'anna.bauer', name: 'Anna', full_name: 'Anna Bauer', first_login: true,
  }, overrides);
}
function childRow(overrides) {
  return Object.assign({
    id: 'c1', username: 'leo.bauer', name: 'Leo', full_name: 'Leo Bauer', fach: 'Kinderheilkunde', dob: '2018-04-01', guardian_id: 'g1',
  }, overrides);
}

async function setupPage(page) {
  await installMockSupabase(page, {}, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
  await page.waitForTimeout(800);
}

test('a first-time real guardian must change their password before reaching the child picker', async ({ page }) => {
  await setupPage(page);
  const g = guardianRow({ first_login: true });
  const c = childRow();
  await page.evaluate((row) => {
    sb.rpc = (name, args) => {
      if (name === 'patient_login') return Promise.resolve({ data: [], error: null });
      if (name === 'guardian_login') return Promise.resolve({ data: [{ token: 'gtok-1', guardian_id: row.id, full_name: row.full_name, name: row.name, first_login: row.first_login }], error: null });
      if (name === 'check_join_request_status') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
  }, g);
  await page.fill('#username', 'anna.bauer');
  await page.fill('#password', 'temp123');
  await page.click('#loginBtn');
  await page.waitForTimeout(1000);
  const changePwActive = await page.evaluate(() => document.getElementById('screen-changepw').classList.contains('active'));
  expect(changePwActive, 'a first-login guardian must be routed to the password-change screen, not straight to the child picker').toBe(true);

  const result = await page.evaluate(async (childData) => {
    sb.rpc = (name, args) => {
      if (name === 'guardian_change_password') return Promise.resolve({ data: true, error: null });
      if (name === 'guardian_get_children') return Promise.resolve({ data: [childData], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    document.getElementById('newPw').value = 'neuespasswort1';
    document.getElementById('confirmPw').value = 'neuespasswort1';
    await saveNewPw();
    return {
      pickerActive: document.getElementById('screen-child-picker').classList.contains('active'),
      listHtml: document.getElementById('childPickerList').innerHTML,
    };
  }, c);
  expect(result.pickerActive).toBe(true);
  expect(result.listHtml).toContain('Leo Bauer');
});

test('a returning (non-first-login) guardian goes straight to the child picker', async ({ page }) => {
  await setupPage(page);
  const g = guardianRow({ first_login: false });
  const c = childRow();
  const result = await page.evaluate(async ({ row, childData }) => {
    sb.rpc = (name) => {
      if (name === 'patient_login') return Promise.resolve({ data: [], error: null });
      if (name === 'guardian_login') return Promise.resolve({ data: [{ token: 'gtok-2', guardian_id: row.id, full_name: row.full_name, name: row.name, first_login: row.first_login }], error: null });
      if (name === 'guardian_get_children') return Promise.resolve({ data: [childData], error: null });
      if (name === 'check_join_request_status') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    document.getElementById('username').value = 'anna.bauer';
    document.getElementById('password').value = 'realpassword';
    await doLogin();
    await new Promise(r => setTimeout(r, 1000));
    return {
      pickerActive: document.getElementById('screen-child-picker').classList.contains('active'),
      changePwActive: document.getElementById('screen-changepw').classList.contains('active'),
      listHtml: document.getElementById('childPickerList').innerHTML,
    };
  }, { row: g, childData: c });
  expect(result.changePwActive).toBe(false);
  expect(result.pickerActive).toBe(true);
  expect(result.listHtml).toContain('Leo Bauer');
});

test('selecting a child mints a real child-scoped patient session token and stores the right session identity', async ({ page }) => {
  await setupPage(page);
  const g = guardianRow({ first_login: false });
  const c = childRow();
  const result = await page.evaluate(async ({ row, childData }) => {
    sb.rpc = (name, args) => {
      if (name === 'patient_login') return Promise.resolve({ data: [], error: null });
      if (name === 'guardian_login') return Promise.resolve({ data: [{ token: 'gtok-3', guardian_id: row.id, full_name: row.full_name, name: row.name, first_login: row.first_login }], error: null });
      if (name === 'guardian_get_children') return Promise.resolve({ data: [childData], error: null });
      if (name === 'guardian_select_child') {
        window.__store.patient_sessions.push({ token: 'ptok-child-1', patient_id: args.p_child_id });
        return Promise.resolve({ data: 'ptok-child-1', error: null });
      }
      if (name === 'check_join_request_status') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    document.getElementById('username').value = 'anna.bauer';
    document.getElementById('password').value = 'realpassword';
    await doLogin();
    await new Promise(r => setTimeout(r, 1000));
    await selectChildProfile(childData.id);
    return {
      patientToken: sessionStorage.getItem('smartordi_patient_token'),
      user: JSON.parse(sessionStorage.getItem('smartordi_user') || 'null'),
    };
  }, { row: g, childData: c });
  expect(result.patientToken).toBe('ptok-child-1');
  expect(result.user.username).toBe('leo.bauer');
  expect(result.user.name).toBe('Leo');
});

test('a failed child selection shows an error instead of silently proceeding', async ({ page }) => {
  await setupPage(page);
  const g = guardianRow({ first_login: false });
  const c = childRow();
  const result = await page.evaluate(async ({ row, childData }) => {
    sb.rpc = (name) => {
      if (name === 'patient_login') return Promise.resolve({ data: [], error: null });
      if (name === 'guardian_login') return Promise.resolve({ data: [{ token: 'gtok-4', guardian_id: row.id, full_name: row.full_name, name: row.name, first_login: row.first_login }], error: null });
      if (name === 'guardian_get_children') return Promise.resolve({ data: [childData], error: null });
      if (name === 'guardian_select_child') return Promise.resolve({ data: null, error: { message: 'simulated error' } });
      if (name === 'check_join_request_status') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    document.getElementById('username').value = 'anna.bauer';
    document.getElementById('password').value = 'realpassword';
    await doLogin();
    await new Promise(r => setTimeout(r, 1000));
    await selectChildProfile(childData.id);
    return {
      errorShown: document.getElementById('childPickerErrorMsg').classList.contains('show'),
      patientToken: sessionStorage.getItem('smartordi_patient_token'),
    };
  }, { row: g, childData: c });
  expect(result.errorShown).toBe(true);
  expect(result.patientToken).toBeFalsy();
});
