// Regression coverage for supabase/phase65_patient_username_change_and_
// is_child.sql's patient_change_username() RPC, wired into patient-login.
// html's existing first-login "Neues Passwort wählen" screen.
//
// Real user feedback (2026-08-11): the username secretary.html's QR flow
// auto-generates (slugified from the patient's full name, e.g.
// "max.mustermann") is easy to forget, especially since the patient never
// types it themselves at signup -- they only ever scan a QR and set a
// password. #newUsername (pre-filled with the current username) lets them
// pick their own, memorable one right there, alongside the password field
// that screen already has.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

const BASE_PATIENT = {
  id: 'p1', username: 'max.mustermann', full_name: 'Max Mustermann', name: 'Max',
  fach: 'Allgemeinmedizin', join_status: 'approved', first_login: true, anamnese: { done: true },
  versicherung: 'ÖGK', svnr: '1234567890', dob: '1990-05-12',
};

async function setupFirstLogin(page, patient) {
  await installMockSupabase(page, { practice_settings: [{ id: true }], patients: [patient] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  page.on('dialog', d => d.dismiss());
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
  await page.waitForTimeout(500);
  await page.evaluate((row) => {
    window.__rpcCalls = [];
    sb.auth.signInWithPassword = () => Promise.resolve({ data: { user: { id: 'auth-p1' } }, error: null });
    sb.rpc = (name, args) => {
      window.__rpcCalls.push({ name, args });
      const p = window.__store.patients.find(x => x.id === 'p1');
      if (name === 'patient_login_precheck') return Promise.resolve({ data: 'p_p1@patients.smartordi.internal', error: null });
      if (name === 'patient_get_profile') {
        return Promise.resolve({ data: [{ id: p.id, username: p.username, full_name: p.full_name, name: p.name, first_login: p.first_login, join_status: p.join_status, join_note: null, anamnese: p.anamnese }], error: null });
      }
      if (name === 'patient_mark_password_changed') { p.first_login = false; return Promise.resolve({ data: true, error: null }); }
      if (name === 'patient_change_username') {
        const u = String(args.p_new_username || '').toLowerCase().trim();
        if (u.length < 3) return Promise.resolve({ data: null, error: { message: 'username_too_short' } });
        if (window.__store.patients.some(x => x.username === u && x.id !== p.id)) return Promise.resolve({ data: null, error: { message: 'username_taken' } });
        p.username = u;
        return Promise.resolve({ data: true, error: null });
      }
      if (name === 'check_join_request_status') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
  }, patient);
  await page.fill('#username', patient.username);
  await page.fill('#password', 'demo123');
  await page.click('#loginBtn');
  // doLogin() wraps its real logic in a 900ms setTimeout (an artificial
  // "checking..." delay, see doLogin() in patient-login.html) before the
  // async patientLogin()/patient_get_profile chain even starts.
  await page.waitForTimeout(1600);
}

test('the first-login screen shows a username field pre-filled with the current username', async ({ page }) => {
  await setupFirstLogin(page, BASE_PATIENT);
  const state = await page.evaluate(() => ({
    changepwActive: document.getElementById('screen-changepw').classList.contains('active'),
    groupVisible: getComputedStyle(document.getElementById('newUsernameGroup')).display !== 'none',
    value: document.getElementById('newUsername').value,
  }));
  expect(state.changepwActive).toBe(true);
  expect(state.groupVisible).toBe(true);
  expect(state.value).toBe('max.mustermann');
});

test('leaving the username field untouched never calls patient_change_username', async ({ page }) => {
  await setupFirstLogin(page, BASE_PATIENT);
  await page.fill('#newPw', 'neuesPasswort1');
  await page.fill('#confirmPw', 'neuesPasswort1');
  await page.evaluate(() => saveNewPw());
  await page.waitForTimeout(300);
  const calls = await page.evaluate(() => window.__rpcCalls.map(c => c.name));
  expect(calls).not.toContain('patient_change_username');
  expect(calls).toContain('patient_mark_password_changed');
});

test('choosing a new, available username actually renames the patient server-side', async ({ page }) => {
  await setupFirstLogin(page, BASE_PATIENT);
  await page.fill('#newUsername', 'MaxM_2026');
  await page.fill('#newPw', 'neuesPasswort1');
  await page.fill('#confirmPw', 'neuesPasswort1');
  await page.evaluate(() => saveNewPw());
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => ({
    calls: window.__rpcCalls.map(c => c.name),
    serverUsername: window.__store.patients.find(p => p.id === 'p1').username,
    currentUserUsername: currentUser && currentUser.username,
  }));
  expect(result.calls).toContain('patient_change_username');
  // The RPC lower/trims server-side (supabase/phase65_...sql) -- the raw,
  // as-typed casing must not leak into the stored username.
  expect(result.serverUsername).toBe('maxm_2026');
  expect(result.currentUserUsername).toBe('maxm_2026');
});

test('a username already taken by another patient shows an error and does not change the password', async ({ page }) => {
  await setupFirstLogin(page, BASE_PATIENT);
  await page.evaluate(() => { window.__store.patients.push({ id: 'p2', username: 'taken.name', full_name: 'Other Patient' }); });
  await page.fill('#newUsername', 'taken.name');
  await page.fill('#newPw', 'neuesPasswort1');
  await page.fill('#confirmPw', 'neuesPasswort1');
  await page.evaluate(() => saveNewPw());
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => ({
    calls: window.__rpcCalls.map(c => c.name),
    errorShown: document.getElementById('errorMsg2').classList.contains('show'),
    errorText: document.getElementById('errorText2').textContent,
    changepwStillActive: document.getElementById('screen-changepw').classList.contains('active'),
  }));
  expect(result.calls).toContain('patient_change_username');
  expect(result.calls).not.toContain('patient_mark_password_changed');
  expect(result.errorShown).toBe(true);
  expect(result.errorText).toBeTruthy();
  expect(result.changepwStillActive).toBe(true);
});

test('a guardian first-login session hides the username field entirely (patient_change_username has no guardian identity to act on)', async ({ page }) => {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  page.on('dialog', d => d.dismiss());
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    sb.auth.signInWithPassword = () => Promise.resolve({ data: { user: null }, error: { message: 'not a patient' } });
    window.guardianLogin = async () => ({ name: 'Erika Muster', fullName: 'Erika Muster', firstLogin: true });
    sb.rpc = (name) => {
      if (name === 'check_join_request_status') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
  });
  await page.fill('#username', 'erika.guardian');
  await page.fill('#password', 'demo123');
  await page.click('#loginBtn');
  await page.waitForTimeout(1600);
  const state = await page.evaluate(() => ({
    changepwActive: document.getElementById('screen-changepw').classList.contains('active'),
    groupVisible: getComputedStyle(document.getElementById('newUsernameGroup')).display !== 'none',
  }));
  expect(state.changepwActive).toBe(true);
  expect(state.groupVisible).toBe(false);
});
