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

// simulateQrNewAccount (real user request, 2026-08-19): mirrors what
// tryQrLogin() would have set from a QR URL's own nu=1 param
// (secretary.html's buildPatientLoginUrl(...,true), see doLogin()'s own
// comment on _qrNeedsNewUsername) -- these tests log in through the plain
// username/password fields rather than a real QR-carrying URL, so the flag
// is set directly instead of round-tripping through window.location.search.
async function setupFirstLogin(page, patient, simulateQrNewAccount) {
  await installMockSupabase(page, { practice_settings: [{ id: true }], patients: [patient] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  page.on('dialog', d => d.dismiss());
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
  await page.waitForTimeout(500);
  if (simulateQrNewAccount) await page.evaluate(() => { _qrNeedsNewUsername = true; });
  await page.evaluate((row) => {
    window.__rpcCalls = [];
    sb.auth.signInWithPassword = () => Promise.resolve({ data: { user: { id: 'auth-p1' } }, error: null });
    sb.rpc = (name, args) => {
      window.__rpcCalls.push({ name, args });
      const p = window.__store.patients.find(x => x.id === 'p1');
      if (name === 'patient_login_precheck') return Promise.resolve({ data: 'p_p1@patients.smartordi.internal', error: null });
      if (name === 'patient_get_profile') {
        return Promise.resolve({ data: [{ id: p.id, username: p.username, full_name: p.full_name, name: p.name, first_login: p.first_login, join_status: p.join_status, join_note: null, anamnese: p.anamnese, is_child: p.is_child }], error: null });
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

// Real user request (2026-08-19): secretary.html's "+ Neuer Patient" ->
// "Kind" -> "Erstes Kind" issues the exact same QR/first-login flow above,
// but for a brand-new children's account the whole point is the parent
// picks BOTH the username and password themselves -- pre-filling the
// secretary-generated username (the adult behavior every test above
// exercises) would just invite leaving it untouched, same as most adults
// already do. See patient-login.html's doLogin()/saveNewPw() own comments.
// Reuses id:'p1' (not a distinct 'c1') -- setupFirstLogin()'s own mock
// (patient_login_precheck/patient_get_profile above) is hardcoded to look
// up 'p1' regardless of which patient is under test, same as every other
// test in this file relies on.
const CHILD_PATIENT = Object.assign({}, BASE_PATIENT, {
  username: 'tom.huber', full_name: 'Tom Huber', name: 'Tom', is_child: true,
});

test('a child account\'s first login leaves the username field BLANK (not pre-filled) with child-specific title/notice text', async ({ page }) => {
  await setupFirstLogin(page, CHILD_PATIENT);
  const state = await page.evaluate(() => ({
    value: document.getElementById('newUsername').value,
    title: document.getElementById('changePwTitle').textContent,
    notice: document.getElementById('newUsernameNotice').textContent,
  }));
  expect(state.value).toBe('');
  expect(state.title).toBe('Konto für Ihr Kind einrichten');
  expect(state.notice).toBe('Bitte wählen Sie einen Benutzernamen für dieses Konto.');
});

test('an adult account\'s first login keeps the pre-filled username and the ordinary title (unaffected by the child case above)', async ({ page }) => {
  await setupFirstLogin(page, BASE_PATIENT);
  const state = await page.evaluate(() => ({
    value: document.getElementById('newUsername').value,
    title: document.getElementById('changePwTitle').textContent,
  }));
  expect(state.value).toBe('max.mustermann');
  expect(state.title).toBe('Neues Passwort wählen');
});

test('submitting a child account\'s first login with an empty username is rejected -- no RPC call, no password change', async ({ page }) => {
  await setupFirstLogin(page, CHILD_PATIENT);
  await page.fill('#newPw', 'neuesPasswort1');
  await page.fill('#confirmPw', 'neuesPasswort1');
  await page.evaluate(() => saveNewPw());
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => ({
    calls: window.__rpcCalls.map(c => c.name),
    errorShown: document.getElementById('errorMsg2').classList.contains('show'),
    changepwStillActive: document.getElementById('screen-changepw').classList.contains('active'),
  }));
  expect(result.calls).not.toContain('patient_change_username');
  expect(result.calls).not.toContain('patient_mark_password_changed');
  expect(result.errorShown).toBe(true);
  expect(result.changepwStillActive).toBe(true);
});

test('a child account can still complete first login once BOTH a username and password are actually chosen', async ({ page }) => {
  await setupFirstLogin(page, CHILD_PATIENT);
  await page.fill('#newUsername', 'tom2026');
  await page.fill('#newPw', 'neuesPasswort1');
  await page.fill('#confirmPw', 'neuesPasswort1');
  await page.evaluate(() => saveNewPw());
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => ({
    calls: window.__rpcCalls.map(c => c.name),
    serverUsername: window.__store.patients.find(p => p.id === 'p1').username,
  }));
  expect(result.calls).toContain('patient_change_username');
  expect(result.calls).toContain('patient_mark_password_changed');
  expect(result.serverUsername).toBe('tom2026');
});

// Real user request (2026-08-19): the "blank + mandatory username, chosen by
// the real user, never generated by the secretary" behavior above used to
// apply only to a child's "Erstes Kind" flow (via acc.isChild) -- now
// extends to an ordinary ADULT account too, whenever the QR that logged the
// patient in for the first time was one secretary.html's "+ Neuer Patient"
// just generated (nu=1, see buildPatientLoginUrl()/_qrNeedsNewUsername).
// BASE_PATIENT (is_child: undefined/falsy) is reused here -- it's the QR
// flag, not is_child, that must drive this case.
test('a brand-new ADULT account\'s first login (QR with nu=1) also leaves the username field BLANK with new-account-specific title/notice text -- distinct from both the child wording and the plain reset default', async ({ page }) => {
  await setupFirstLogin(page, BASE_PATIENT, true);
  const state = await page.evaluate(() => ({
    value: document.getElementById('newUsername').value,
    title: document.getElementById('changePwTitle').textContent,
    notice: document.getElementById('newUsernameNotice').textContent,
  }));
  expect(state.value).toBe('');
  expect(state.title).toBe('Konto einrichten');
  expect(state.notice).toBe('Bitte wählen Sie einen Benutzernamen für Ihr Konto.');
});

test('submitting a brand-new adult account\'s first login with an empty username is rejected, same as the child case', async ({ page }) => {
  await setupFirstLogin(page, BASE_PATIENT, true);
  await page.fill('#newPw', 'neuesPasswort1');
  await page.fill('#confirmPw', 'neuesPasswort1');
  await page.evaluate(() => saveNewPw());
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => ({
    calls: window.__rpcCalls.map(c => c.name),
    errorShown: document.getElementById('errorMsg2').classList.contains('show'),
    changepwStillActive: document.getElementById('screen-changepw').classList.contains('active'),
  }));
  expect(result.calls).not.toContain('patient_change_username');
  expect(result.calls).not.toContain('patient_mark_password_changed');
  expect(result.errorShown).toBe(true);
  expect(result.changepwStillActive).toBe(true);
});

// The critical regression this whole feature depends on: an EXISTING
// patient whose password was reset (resetPatientPassword()/selectQrPatient())
// also gets first_login:true and isChild:false, but was NOT logged in via a
// nu=1 QR -- _qrNeedsNewUsername stays false, so this must keep today's
// "pre-filled, optional" behavior exactly as before (BASE_PATIENT without
// the third `true` argument, i.e. the same call the earlier "adult account"
// regression test above already makes -- this one just makes the contrast
// with the nu=1 case above explicit).
test('an existing adult\'s password-reset first login (no QR / no nu=1) is unaffected by the new-account case above', async ({ page }) => {
  await setupFirstLogin(page, BASE_PATIENT, false);
  const state = await page.evaluate(() => ({
    value: document.getElementById('newUsername').value,
    title: document.getElementById('changePwTitle').textContent,
  }));
  expect(state.value).toBe('max.mustermann');
  expect(state.title).toBe('Neues Passwort wählen');
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
