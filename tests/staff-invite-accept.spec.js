// Regression test for acceptStaffInvite() in login.html -- the counterpart
// to the patient join-request review flow already covered in
// join-request-review.spec.js, but for staff onboarding: this is the gate
// that turns a team-invite link into a real Supabase Auth account with
// full staff access (every patient at the practice). None of its
// validation branches or its RPC-failure handling had any test coverage.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function setupPage(page) {
  await installMockSupabase(page, { practice_settings: [{ id: true }] });
  await page.goto('file://' + path.join(__dirname, '..', 'login.html'));
  await page.waitForTimeout(800);
  // Bypass the ?invite=token URL flow (which depends on validate_staff_invite)
  // and set the two module-level globals tryStaffInviteScreen() would have
  // set, exactly like other specs poke at app-level state directly.
  await page.evaluate(() => {
    staffInviteToken = 'inv_test123';
    staffInviteInfo = { role: 'arzt', fach: 'Allgemeinmedizin' };
  });
}

async function fillInviteForm(page, { vorname = 'Neu', nachname = 'Arzt', email = 'neu.arzt@example.at', pw = 'sicher123', confirmPw = 'sicher123' } = {}) {
  await page.evaluate(({ vorname, nachname, email, pw, confirmPw }) => {
    document.getElementById('inviteVorname').value = vorname;
    document.getElementById('inviteNachname').value = nachname;
    document.getElementById('inviteEmail').value = email;
    document.getElementById('invitePassword').value = pw;
    document.getElementById('invitePasswordConfirm').value = confirmPw;
  }, { vorname, nachname, email, pw, confirmPw });
}

test('rejects an incomplete form without ever calling signUp', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    let signUpCalled = false;
    sb.auth.signUp = async () => { signUpCalled = true; return { data: null, error: null }; };
    document.getElementById('inviteVorname').value = '';
    document.getElementById('inviteNachname').value = '';
    document.getElementById('inviteEmail').value = '';
    document.getElementById('invitePassword').value = '';
    document.getElementById('invitePasswordConfirm').value = '';
    await acceptStaffInvite();
    return {
      errorVisible: document.getElementById('inviteErrorMsg').classList.contains('show'),
      errorText: document.getElementById('inviteErrorText').textContent,
      signUpCalled,
    };
  });
  expect(result.errorVisible).toBe(true);
  expect(result.errorText).toContain('alle Felder ausfüllen');
  expect(result.signUpCalled, 'must not attempt to sign up with an incomplete form').toBe(false);
});

test('rejects an invalid email address', async ({ page }) => {
  await setupPage(page);
  await fillInviteForm(page, { email: 'not-an-email' });
  const result = await page.evaluate(async () => {
    await acceptStaffInvite();
    return document.getElementById('inviteErrorText').textContent;
  });
  expect(result).toContain('gültige E-Mail');
});

test('rejects a password shorter than 6 characters', async ({ page }) => {
  await setupPage(page);
  await fillInviteForm(page, { pw: 'abc', confirmPw: 'abc' });
  const result = await page.evaluate(async () => {
    await acceptStaffInvite();
    return document.getElementById('inviteErrorText').textContent;
  });
  expect(result).toContain('mindestens 6 Zeichen');
});

test('rejects mismatched password confirmation', async ({ page }) => {
  await setupPage(page);
  await fillInviteForm(page, { pw: 'sicher123', confirmPw: 'anders456' });
  const result = await page.evaluate(async () => {
    await acceptStaffInvite();
    return document.getElementById('inviteErrorText').textContent;
  });
  expect(result).toContain('stimmen nicht überein');
});

test('a valid form that signs up but fails to consume the invite (used/expired) does not sign the user in', async ({ page }) => {
  await setupPage(page);
  await fillInviteForm(page);
  const result = await page.evaluate(async () => {
    sb.auth.signUp = async () => ({ data: { user: { id: 'new-uid' } }, error: null });
    sb.rpc = async () => ({ data: null, error: null }); // consume_staff_invite: falsy -> already used/expired
    await acceptStaffInvite();
    return {
      errorText: document.getElementById('inviteErrorText').textContent,
      sessionSet: sessionStorage.getItem('smartordi_user'),
    };
  });
  expect(result.errorText).toContain('wurde inzwischen verwendet oder ist abgelaufen');
  expect(result.sessionSet, 'a failed invite consumption must never sign the user in').toBeNull();
});

test('a fully valid submission consumes the invite and signs the new staff member in with the right role', async ({ page }) => {
  await setupPage(page);
  await fillInviteForm(page, { vorname: 'Jonas', nachname: 'Berger', email: 'jonas@example.at' });
  const result = await page.evaluate(async () => {
    let consumeArgs = null;
    sb.auth.signUp = async () => ({ data: { user: { id: 'new-uid-42' } }, error: null });
    sb.rpc = async (name, args) => {
      if (name === 'consume_staff_invite') { consumeArgs = args; return { data: true, error: null }; }
      return { data: null, error: null };
    };
    await acceptStaffInvite();
    return { sessionUser: JSON.parse(sessionStorage.getItem('smartordi_user') || 'null'), consumeArgs };
  });
  expect(result.sessionUser).toEqual({ role: 'arzt', name: 'Jonas Berger', username: 'new-uid-42', isAdmin: false });
  expect(result.consumeArgs).toEqual({ p_token: 'inv_test123', p_user_id: 'new-uid-42', p_vorname: 'Jonas', p_nachname: 'Berger' });
});

test('an email already registered with Supabase Auth gets a clear, specific error', async ({ page }) => {
  await setupPage(page);
  await fillInviteForm(page);
  const result = await page.evaluate(async () => {
    sb.auth.signUp = async () => ({ data: null, error: { message: 'User already registered' } });
    await acceptStaffInvite();
    return document.getElementById('inviteErrorText').textContent;
  });
  expect(result).toContain('bereits registriert');
});
