// Regression test for a real, currently-live registration-blocking bug:
// register.html used to create the practices + staff_profiles rows
// immediately after sb.auth.signUp(), regardless of whether that signUp()
// actually returned an active session. On any Supabase project with
// "Confirm email" enabled (the default), signUp() creates the auth user
// but returns session:null until the confirmation link is clicked -- so
// the very next sb.from('practices').insert() ran unauthenticated and was
// rejected by phase15_staff_practice_rls.sql's "insert new practice ...
// to authenticated" RLS policy: "Konto wurde erstellt, aber die Praxis
// konnte nicht angelegt werden: new row violates row-level security
// policy for table practices". Every real doctor registering on such a
// project hit this.
//
// Fix: register.html now stashes the submitted fields as Auth
// user_metadata (survives the confirmation wait) and only calls
// completePendingPracticeRegistration() (vendor/staff-accounts.js) once a
// real session exists -- either immediately (confirmation disabled, same
// as before) or on the user's first successful login.html sign-in after
// confirming, which this file also covers.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function fillRegisterForm(page) {
  await page.evaluate(() => {
    document.getElementById('f-vorname').value = 'Sarah';
    document.getElementById('f-nachname').value = 'Ahmed';
    document.getElementById('f-fach').value = document.getElementById('f-fach').options[1]?.value || 'Allgemeinmedizin';
    document.getElementById('f-ordination').value = 'Test Ordination';
    document.getElementById('f-adresse').value = 'Teststraße 1, Linz';
    document.getElementById('f-email').value = 'sarah@example.com';
    document.getElementById('f-tel').value = '+43 660 1234567';
    document.getElementById('f-password').value = 'sicheres-passwort-123';
    document.getElementById('f-password-confirm').value = 'sicheres-passwort-123';
    document.getElementById('cb-dsgvo').checked = true;
    document.getElementById('cb-agb').checked = true;
  });
}

test('when Supabase requires e-mail confirmation (signUp returns no session), register.html defers the practice/profile creation instead of hitting the RLS error', async ({ page }) => {
  await installMockSupabase(page, {});
  await page.goto('file://' + path.join(__dirname, '..', 'register.html'));
  await page.waitForTimeout(1000);
  await fillRegisterForm(page);

  const after = await page.evaluate(async () => {
    sb.auth.signUp = (creds) => Promise.resolve({
      data: { user: { id: 'new-user-uuid', email: creds.email, user_metadata: creds.options.data }, session: null },
      error: null,
    });
    await doRegister();
    await new Promise(r => setTimeout(r, 300));
    return {
      practices: window.__store.practices,
      staffProfiles: window.__store.staff_profiles,
      confirmVisible: document.getElementById('confirmEmailOverlay').classList.contains('show'),
      successVisible: document.getElementById('successOverlay').classList.contains('show'),
    };
  });

  expect(after.practices, 'must not attempt the RLS-doomed insert without a session').toHaveLength(0);
  expect(after.staffProfiles).toHaveLength(0);
  expect(after.confirmVisible).toBe(true);
  expect(after.successVisible).toBe(false);
});

test('when signUp already returns an active session (e-mail confirmation disabled), registration still completes immediately as before', async ({ page }) => {
  await installMockSupabase(page, {});
  await page.goto('file://' + path.join(__dirname, '..', 'register.html'));
  await page.waitForTimeout(1000);
  await fillRegisterForm(page);

  const after = await page.evaluate(async () => {
    await doRegister();
    await new Promise(r => setTimeout(r, 700));
    return {
      practices: window.__store.practices,
      staffProfiles: window.__store.staff_profiles,
      successVisible: document.getElementById('successOverlay').classList.contains('show'),
    };
  });

  expect(after.practices).toHaveLength(1);
  expect(after.practices[0].name).toBe('Test Ordination');
  expect(after.staffProfiles).toHaveLength(1);
  expect(after.successVisible).toBe(true);
});

// Real bug, confirmed on a live re-test (2026-08-17): even with "Confirm
// email" disabled (signUp() already returns a session, the case covered by
// the test just above), the very first authenticated request right after
// that -- this practices insert -- could still be rejected with the same
// RLS error, as a short-lived gap rather than a permanent failure. See
// completePendingPracticeRegistration()'s own comment (vendor/staff-
// accounts.js) for the retry this test covers.
test('a transient RLS rejection on the first practices insert is retried once (after re-confirming a real session exists) and recovers', async ({ page }) => {
  await installMockSupabase(page, {});
  await page.goto('file://' + path.join(__dirname, '..', 'register.html'));
  await page.waitForTimeout(1000);
  await fillRegisterForm(page);

  const after = await page.evaluate(async () => {
    // getSession() must report a real session for the retry to even
    // attempt the second insert -- see its own guard in
    // completePendingPracticeRegistration().
    window.__mockAuthSession = { user: { id: 'new-user-uuid' } };
    // mockSupabase's single() reads window.__forceError[table] TWICE per
    // resolution when it's about to report an error (once for the "is an
    // error forced?" check, once more inside __forceErrorObj() to build the
    // actual error payload) but only ONCE when it isn't -- so the first
    // (should-fail) attempt needs two consistent truthy reads, and the
    // second (should-succeed) attempt needs its one read to be falsy.
    let calls = 0;
    window.__forceError = {};
    Object.defineProperty(window.__forceError, 'practices', {
      configurable: true,
      get() {
        calls++;
        return calls <= 2 ? { message: 'new row violates row-level security policy for table "practices"' } : undefined;
      },
    });
    await doRegister();
    await new Promise(r => setTimeout(r, 1200));
    delete window.__forceError;
    return {
      calls,
      practices: window.__store.practices,
      staffProfiles: window.__store.staff_profiles,
      successVisible: document.getElementById('successOverlay').classList.contains('show'),
    };
  });

  expect(after.calls, 'must have actually retried, not just succeeded on the first try').toBeGreaterThanOrEqual(3);
  expect(after.practices).toHaveLength(1);
  expect(after.practices[0].name).toBe('Test Ordination');
  expect(after.staffProfiles).toHaveLength(1);
  expect(after.successVisible).toBe(true);
});

test("login.html finishes a deferred registration on first sign-in after confirmation", async ({ page }) => {
  await installMockSupabase(page, {});
  await page.goto('file://' + path.join(__dirname, '..', 'login.html'));
  await page.waitForTimeout(500);

  const result = await page.evaluate(async () => {
    sb.auth.signInWithPassword = () => Promise.resolve({
      data: {
        user: {
          id: 'new-user-uuid', email: 'sarah@example.com',
          user_metadata: {
            pending_practice_registration: true, titel: 'Dr.', vorname: 'Sarah', nachname: 'Ahmed',
            fach: 'Allgemeinmedizin', ordination: 'Test Ordination', adresse: 'Teststraße 1, Linz',
            tel: '+43 660 1234567', plan: 'standard', policy_version: '2.1',
          },
        },
      },
      error: null,
    });
    document.getElementById('email').value = 'sarah@example.com';
    document.getElementById('password').value = 'sicheres-passwort-123';
    await doLogin();
    return {
      practices: window.__store.practices,
      staffProfiles: window.__store.staff_profiles,
      // sessionStorage.smartordi_user is only ever set right before the
      // role-based redirect (see doLogin()'s last two lines) -- its
      // presence with role:'arzt' is what actually proves the redirect
      // target would be doctor.html, since window.location.href doesn't
      // reflect the in-flight navigation synchronously in this environment.
      sessionUser: JSON.parse(sessionStorage.getItem('smartordi_user') || 'null'),
    };
  });

  expect(result.practices).toHaveLength(1);
  expect(result.practices[0].name).toBe('Test Ordination');
  expect(result.staffProfiles).toHaveLength(1);
  expect(result.staffProfiles[0].practice_id).toBe(result.practices[0].id);
  expect(result.sessionUser.role).toBe('arzt');
  expect(result.sessionUser.isAdmin).toBe(true);
});

test('login.html shows a real error (not a silent/false success) if completing a deferred registration fails', async ({ page }) => {
  await installMockSupabase(page, {});
  await page.goto('file://' + path.join(__dirname, '..', 'login.html'));
  await page.waitForTimeout(500);

  const result = await page.evaluate(async () => {
    sb.auth.signInWithPassword = () => Promise.resolve({
      data: {
        user: {
          id: 'new-user-uuid', email: 'sarah@example.com',
          user_metadata: {
            pending_practice_registration: true, vorname: 'Sarah', nachname: 'Ahmed',
            fach: 'Allgemeinmedizin', ordination: 'Test Ordination', adresse: 'x', tel: 'y', plan: 'standard',
          },
        },
      },
      error: null,
    });
    const origFrom = sb.from.bind(sb);
    sb.from = (table) => {
      if (table === 'practices') {
        return { insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'simulated insert failure' } }) }) }) };
      }
      return origFrom(table);
    };
    document.getElementById('email').value = 'sarah@example.com';
    document.getElementById('password').value = 'sicheres-passwort-123';
    await doLogin();
    await new Promise(r => setTimeout(r, 300));
    return {
      errorVisible: document.getElementById('errorMsg').classList.contains('show'),
      errorText: document.getElementById('errorText').textContent,
      sessionUser: sessionStorage.getItem('smartordi_user'),
      redirected: window.location.href,
    };
  });

  expect(result.errorVisible).toBe(true);
  expect(result.errorText).toContain('nicht eingerichtet werden');
  expect(result.sessionUser).toBeNull();
  expect(result.redirected).not.toContain('doctor.html');
});

test('login.html tells the user to confirm their e-mail first, instead of a generic wrong-password message', async ({ page }) => {
  await installMockSupabase(page, {});
  await page.goto('file://' + path.join(__dirname, '..', 'login.html'));
  await page.waitForTimeout(500);

  const result = await page.evaluate(async () => {
    sb.auth.signInWithPassword = () => Promise.resolve({
      data: { user: null },
      error: { message: 'Email not confirmed', code: 'email_not_confirmed' },
    });
    document.getElementById('email').value = 'sarah@example.com';
    document.getElementById('password').value = 'sicheres-passwort-123';
    await doLogin();
    await new Promise(r => setTimeout(r, 300));
    return document.getElementById('errorText').textContent;
  });

  expect(result).toContain('bestätigen');
});
