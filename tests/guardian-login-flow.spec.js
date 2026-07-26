// Regression test for supabase/phase28_guardian_child_accounts.sql's
// guardian-facing login flow in patient-login.html: guardianLogin() (now a
// precheck RPC + a real sb.auth.signInWithPassword(), see
// supabase/phase33_patient_login_cutover.sql) -> (first login only) change
// password -> child picker -> guardianSelectChild() records which child
// this guardian's own Auth session is "acting as"
// (guardian_active_child, phase31). From that point on patient.html should
// treat the session exactly like a real direct patient login -- this test
// only covers up through that hand-off, not patient.html itself (already
// covered by its own test suite).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function guardianProfileRow(overrides) {
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
  // Every test below signs in as the guardian the same way: patient_login_
  // precheck misses (so doLogin() falls through to the guardian branch),
  // guardian_login_precheck succeeds with a synthetic email, and
  // sb.auth.signInWithPassword succeeds -- exactly the real sequence
  // patientLogin()/guardianLogin() (vendor/patient-portal-data.js) drive.
  // Defined as a real page-global (not a Node-side helper) since
  // page.evaluate() callbacks run in the browser and can't close over
  // this test file's own scope.
  await page.evaluate(() => {
    window.mockGuardianSignIn = function (profile) {
      sb.rpc = (name) => {
        if (name === 'patient_login_precheck') return Promise.resolve({ data: null, error: null });
        if (name === 'guardian_login_precheck') return Promise.resolve({ data: 'g_g1@guardians.smartordi.internal', error: null });
        if (name === 'guardian_get_profile') return Promise.resolve({ data: [profile], error: null });
        if (name === 'check_join_request_status') return Promise.resolve({ data: [], error: null });
        return Promise.resolve({ data: null, error: null });
      };
      sb.auth.signInWithPassword = () => Promise.resolve({ data: { user: { id: 'auth-g1' } }, error: null });
    };
  });
}

test('a first-time real guardian must change their password before reaching the child picker', async ({ page }) => {
  await setupPage(page);
  const g = guardianProfileRow({ first_login: true });
  const c = childRow();
  await page.evaluate((row) => { mockGuardianSignIn(row); }, g);
  await page.fill('#username', 'anna.bauer');
  await page.fill('#password', 'temp123');
  await page.click('#loginBtn');
  await page.waitForTimeout(1000);
  const changePwActive = await page.evaluate(() => document.getElementById('screen-changepw').classList.contains('active'));
  expect(changePwActive, 'a first-login guardian must be routed to the password-change screen, not straight to the child picker').toBe(true);

  const result = await page.evaluate(async (childData) => {
    sb.auth.updateUser = () => Promise.resolve({ data: {}, error: null });
    sb.rpc = (name) => {
      if (name === 'guardian_mark_password_changed') return Promise.resolve({ data: true, error: null });
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
  const g = guardianProfileRow({ first_login: false });
  const c = childRow();
  const result = await page.evaluate(async ({ row, childData }) => {
    mockGuardianSignIn(row);
    const baseRpc = sb.rpc;
    sb.rpc = (name, args) => {
      if (name === 'guardian_get_children') return Promise.resolve({ data: [childData], error: null });
      return baseRpc(name, args);
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

test('selecting a child records the guardian\'s active child and stores the right session identity', async ({ page }) => {
  await setupPage(page);
  const g = guardianProfileRow({ first_login: false });
  const c = childRow();
  const result = await page.evaluate(async ({ row, childData }) => {
    mockGuardianSignIn(row);
    const baseRpc = sb.rpc;
    sb.rpc = (name, args) => {
      if (name === 'guardian_get_children') return Promise.resolve({ data: [childData], error: null });
      if (name === 'guardian_select_child') {
        window.__store.guardian_active_child = window.__store.guardian_active_child || [];
        window.__store.guardian_active_child.push({ auth_user_id: 'auth-g1', patient_id: args.p_child_id });
        return Promise.resolve({ data: true, error: null });
      }
      return baseRpc(name, args);
    };
    document.getElementById('username').value = 'anna.bauer';
    document.getElementById('password').value = 'realpassword';
    await doLogin();
    await new Promise(r => setTimeout(r, 1000));
    await selectChildProfile(childData.id);
    return {
      patientToken: sessionStorage.getItem('smartordi_patient_token'),
      user: JSON.parse(sessionStorage.getItem('smartordi_user') || 'null'),
      activeChild: window.__store.guardian_active_child,
    };
  }, { row: g, childData: c });
  expect(result.patientToken, 'a truthy marker is stored -- the real credential is the guardian\'s own Supabase Auth session').toBeTruthy();
  expect(result.user.username).toBe('leo.bauer');
  expect(result.user.name).toBe('Leo');
  expect(result.activeChild[0]).toEqual({ auth_user_id: 'auth-g1', patient_id: 'c1' });
});

test('a failed child selection shows an error instead of silently proceeding', async ({ page }) => {
  await setupPage(page);
  const g = guardianProfileRow({ first_login: false });
  const c = childRow();
  const result = await page.evaluate(async ({ row, childData }) => {
    mockGuardianSignIn(row);
    const baseRpc = sb.rpc;
    sb.rpc = (name) => {
      if (name === 'guardian_get_children') return Promise.resolve({ data: [childData], error: null });
      if (name === 'guardian_select_child') return Promise.resolve({ data: null, error: { message: 'simulated error' } });
      return baseRpc(name);
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
