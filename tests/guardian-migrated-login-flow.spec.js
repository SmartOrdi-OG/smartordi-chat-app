// Regression coverage for supabase/phase66_retire_guardian_login_system.
// sql (Phase C of the unified-account-profiles work, explicit decision
// 2026-08-11: soft/safe deprecation, not a hard removal). Once that
// migration has carried a guardian's children into patient_account_
// profiles, patient-login.html's guardian login now routes straight into
// patient.html via patientGetProfiles()/patientSwitchProfile() -- the same
// RPCs patient.html's own "Meine Profile" card already uses -- instead of
// the old, guardian-specific child-picker screen. An UNmigrated guardian
// (patient_get_profiles comes back empty) keeps using that old screen
// completely unmodified -- see guardian-login-flow.spec.js, which already
// covers that path and continues to pass unchanged after this file's
// routing change (its mocks never populate patient_get_profiles, so
// ensureActiveProfile() finds nothing and falls straight through to the
// legacy screen, exactly like a real unmigrated guardian would).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function guardianProfileRow(overrides) {
  return Object.assign({
    id: 'g1', username: 'anna.bauer', name: 'Anna', full_name: 'Anna Bauer', first_login: false,
  }, overrides);
}
// The shape patient_get_profile() (singular, current_patient_id()-based)
// returns for the CHILD once patient_switch_profile() has resolved to
// them -- this is what routeGuardianAfterLogin() reads to build the real
// session identity, same as any other profile switch already does.
function childProfileRow(overrides) {
  return Object.assign({
    id: 'c1', username: 'leo.bauer', name: 'Leo', full_name: 'Leo Bauer', fach: 'Kinderheilkunde',
    dob: '2018-04-01', adresse: null, tel: null, email: null, versicherung: null, svnr: null,
    first_login: false, join_status: 'approved', join_note: null, anamnese: { done: true },
  }, overrides);
}

async function setupPage(page) {
  await installMockSupabase(page, {}, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
  await page.waitForTimeout(800);
}

test('a migrated guardian (returning login) is routed straight into patient.html, never sees the old child picker', async ({ page }) => {
  await setupPage(page);
  const g = guardianProfileRow();
  const childProfile = childProfileRow();
  const migratedProfiles = [
    { patient_id: 'c1', full_name: 'Leo Bauer', relation: 'child', relation_label: null, practice_id: 'pr2', practice_name: 'Kinderarzt Dr. Test', is_active: false },
  ];
  // A successful routeGuardianAfterLogin() navigates this same tab to
  // patient.html -- doLogin() is fired WITHOUT awaiting it (its real work
  // runs inside doLogin()'s own internal setTimeout(...,900), well after
  // this evaluate() call has already returned), so the navigation happens
  // on its own time instead of destroying this evaluate's execution
  // context mid-await.
  await page.evaluate(({ row, profiles, child }) => {
    let switchedTo = null;
    sb.rpc = (name, args) => {
      if (name === 'patient_login_precheck') return Promise.resolve({ data: null, error: null });
      if (name === 'guardian_login_precheck') return Promise.resolve({ data: 'g_g1@guardians.smartordi.internal', error: null });
      if (name === 'guardian_get_profile') return Promise.resolve({ data: [row], error: null });
      if (name === 'patient_get_profiles') return Promise.resolve({ data: profiles, error: null });
      if (name === 'patient_switch_profile') { switchedTo = args.p_patient_id; return Promise.resolve({ data: true, error: null }); }
      if (name === 'patient_get_profile') return Promise.resolve({ data: switchedTo ? [child] : [], error: null });
      if (name === 'check_join_request_status') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    sb.auth.signInWithPassword = () => Promise.resolve({ data: { user: { id: 'auth-g1' } }, error: null });
    document.getElementById('username').value = 'anna.bauer';
    document.getElementById('password').value = 'realpassword';
    doLogin();
  }, { row: g, profiles: migratedProfiles, child: childProfile });
  await page.waitForURL('**/patient.html', { timeout: 5000 });
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => ({
    patientToken: sessionStorage.getItem('smartordi_patient_token'),
    user: JSON.parse(sessionStorage.getItem('smartordi_user') || 'null'),
    guardianSessionFlag: sessionStorage.getItem('smartordi_guardian_session'),
  }));
  // Reaching patient.html at all already proves the old, guardian-specific
  // child-picker screen (which never navigates away on its own) was never
  // used -- see the "if patient_switch_profile fails" test below for the
  // contrasting case where that screen IS reached instead.
  expect(result.patientToken).toBeTruthy();
  expect(result.user.username).toBe('leo.bauer');
  expect(result.user.name).toBe('Leo');
  // routeGuardianAfterLogin() never sets this -- a stale '1' from an
  // earlier old-style guardian session in the same tab must not survive.
  expect(result.guardianSessionFlag).toBeFalsy();
});

test('a migrated guardian on first login still changes their password first, then routes straight in (not the old picker)', async ({ page }) => {
  await setupPage(page);
  const g = guardianProfileRow({ first_login: true });
  const childProfile = childProfileRow();
  const migratedProfiles = [
    { patient_id: 'c1', full_name: 'Leo Bauer', relation: 'child', relation_label: null, practice_id: 'pr2', practice_name: 'Kinderarzt Dr. Test', is_active: false },
  ];
  const result = await page.evaluate(async ({ row, profiles, child }) => {
    sb.rpc = (name, args) => {
      if (name === 'patient_login_precheck') return Promise.resolve({ data: null, error: null });
      if (name === 'guardian_login_precheck') return Promise.resolve({ data: 'g_g1@guardians.smartordi.internal', error: null });
      if (name === 'guardian_get_profile') return Promise.resolve({ data: [row], error: null });
      if (name === 'check_join_request_status') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    sb.auth.signInWithPassword = () => Promise.resolve({ data: { user: { id: 'auth-g1' } }, error: null });
    document.getElementById('username').value = 'anna.bauer';
    document.getElementById('password').value = 'temp123';
    await doLogin();
    await new Promise(r => setTimeout(r, 1000));
    const changePwActive = document.getElementById('screen-changepw').classList.contains('active');

    sb.auth.updateUser = () => Promise.resolve({ data: {}, error: null });
    sb.rpc = (name, args) => {
      if (name === 'guardian_mark_password_changed') return Promise.resolve({ data: true, error: null });
      if (name === 'patient_get_profiles') return Promise.resolve({ data: profiles, error: null });
      if (name === 'patient_switch_profile') return Promise.resolve({ data: true, error: null });
      if (name === 'patient_get_profile') return Promise.resolve({ data: [child], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    document.getElementById('newPw').value = 'neuespasswort1';
    document.getElementById('confirmPw').value = 'neuespasswort1';
    await saveNewPw();
    return {
      changePwActive,
      pickerActive: document.getElementById('screen-child-picker').classList.contains('active'),
      user: JSON.parse(sessionStorage.getItem('smartordi_user') || 'null'),
    };
  }, { row: g, profiles: migratedProfiles, child: childProfile });
  expect(result.changePwActive, 'first-login must still require a password change before anything else').toBe(true);
  expect(result.pickerActive).toBe(false);
  expect(result.user.username).toBe('leo.bauer');
});

test('if patient_switch_profile fails even though profiles were found, falls back to the old child-picker screen instead of stranding the guardian', async ({ page }) => {
  await setupPage(page);
  const g = guardianProfileRow();
  const child = childProfileRow();
  const migratedProfiles = [
    { patient_id: 'c1', full_name: 'Leo Bauer', relation: 'child', relation_label: null, practice_id: 'pr2', practice_name: 'Kinderarzt Dr. Test', is_active: false },
  ];
  const result = await page.evaluate(async ({ row, profiles, childData }) => {
    sb.rpc = (name, args) => {
      if (name === 'patient_login_precheck') return Promise.resolve({ data: null, error: null });
      if (name === 'guardian_login_precheck') return Promise.resolve({ data: 'g_g1@guardians.smartordi.internal', error: null });
      if (name === 'guardian_get_profile') return Promise.resolve({ data: [row], error: null });
      if (name === 'patient_get_profiles') return Promise.resolve({ data: profiles, error: null });
      if (name === 'patient_switch_profile') return Promise.resolve({ data: null, error: { message: 'simulated failure' } });
      if (name === 'guardian_get_children') return Promise.resolve({ data: [childData], error: null });
      if (name === 'check_join_request_status') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    sb.auth.signInWithPassword = () => Promise.resolve({ data: { user: { id: 'auth-g1' } }, error: null });
    document.getElementById('username').value = 'anna.bauer';
    document.getElementById('password').value = 'realpassword';
    await doLogin();
    await new Promise(r => setTimeout(r, 1000));
    return {
      pickerActive: document.getElementById('screen-child-picker').classList.contains('active'),
      listHtml: document.getElementById('childPickerList').innerHTML,
      patientToken: sessionStorage.getItem('smartordi_patient_token'),
    };
  }, { row: g, profiles: migratedProfiles, childData: child });
  expect(result.pickerActive, 'a failed switch must never strand the guardian on a blank/broken screen').toBe(true);
  expect(result.listHtml).toContain('Leo Bauer');
  expect(result.patientToken).toBeFalsy();
});
