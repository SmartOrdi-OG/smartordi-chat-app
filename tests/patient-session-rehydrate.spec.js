// Regression coverage for rehydrateSessionFromRealAuth() (patient.html) --
// previously this path had NO automated test at all, because
// mockSupabase.js's sb.auth.getSession() simply mirrored whatever
// sessionStorage.smartordi_user the test itself had already set, which
// makes it structurally impossible to simulate the exact case this
// function exists for: sessionStorage empty/cleared (tab relaunch, mobile
// storage eviction, ...) while a real Supabase Auth session is still valid
// in its own separate storage. window.__mockAuthSession (mockSupabase.js)
// now decouples the two so that case can actually be exercised here.
//
// A second real user report (screenshot) after the Home-screen rollout
// showed the exact "silently looks logged out" symptom again -- static
// "--"/placeholder markup untouched -- even though sessionStorage loss
// alone should be recoverable by the existing fix. One plausible cause:
// a real Auth session that just resumed from the device being backgrounded
// can carry an access token that's technically still stored but stale,
// failing the very first request made against it. rehydrateSessionFromReal
// Auth() now retries once after an explicit sb.auth.refreshSession() before
// giving up -- covered below.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('sessionStorage empty but a real Supabase Auth session is still valid -- rehydrates silently instead of looking logged out', async ({ page }) => {
  // installMockSupabase's extraInit runs via page.addInitScript(), which
  // stringifies the function -- Node-side closures don't survive that, so
  // the mock response has to be a literal written directly in the function
  // body, not a variable captured from outside it (same pattern as
  // patient-register-deeplink.spec.js). This has to be wired into
  // createClient() itself, in place BEFORE navigation, because
  // patient.html's own bootstrap calls initPatientData() automatically the
  // instant the page loads -- patching sb.rpc via a page.evaluate() AFTER
  // page.goto() (the old approach here) is always too late for that first,
  // automatic call. That matters now: a failed rehydrate redirects straight
  // to patient-login.html (see the "genuinely no session" test below), so
  // that very first automatic call has to already succeed, not just a
  // second, test-triggered one.
  await installMockSupabase(page, {}, () => {
    // sessionStorage.smartordi_user is deliberately left unset -- this is
    // the "tab relaunch"/"storage eviction" case, not a normal load.
    window.__mockAuthSession = { user: { id: 'maria.huber' } };
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    const origCreateClient = window.supabase.createClient;
    window.supabase.createClient = (...args) => {
      const client = origCreateClient(...args);
      const origRpc = client.rpc.bind(client);
      client.rpc = (name, params) => {
        if (name === 'patient_get_profile') {
          return Promise.resolve({ data: [{
            id: 'p1', username: 'maria.huber', name: 'Maria', full_name: 'Maria Huber',
            dob: '1985-01-01', adresse: null, tel: null, email: null,
            versicherung: null, svnr: null, first_login: false,
          }], error: null });
        }
        return origRpc(name, params);
      };
      return client;
    };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => ({
    topbarUsername: document.getElementById('topbarUsername').textContent,
    profilName: document.getElementById('profilName').textContent,
    homeGreeting: document.getElementById('homeGreeting').textContent,
    sessionUser: JSON.parse(sessionStorage.getItem('smartordi_user') || 'null'),
    token: sessionStorage.getItem('smartordi_patient_token'),
    bannerDisplay: getComputedStyle(document.getElementById('dataLoadErrorBanner')).display,
  }));
  expect(result.profilName).toBe('Maria Huber');
  expect(result.topbarUsername).toBe('Maria');
  expect(result.homeGreeting).toContain('Maria');
  expect(result.sessionUser && result.sessionUser.username).toBe('maria.huber');
  expect(result.token).toBeTruthy();
  // A successful recovery is silent -- no error banner just because the tab
  // happened to relaunch with empty sessionStorage.
  expect(result.bannerDisplay).toBe('none');
});

test('a stale access token that fails once is retried after refreshSession() before giving up', async ({ page }) => {
  // Same reasoning as the test above -- the mock has to be wired into
  // createClient() before navigation, not patched onto sb afterwards, since
  // patient.html's own bootstrap already calls initPatientData()
  // automatically on load.
  await installMockSupabase(page, {}, () => {
    window.__mockAuthSession = { user: { id: 'maria.huber' } };
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    const origCreateClient = window.supabase.createClient;
    window.supabase.createClient = (...args) => {
      const client = origCreateClient(...args);
      const origRpc = client.rpc.bind(client);
      let profileCalls = 0;
      client.rpc = (name, params) => {
        if (name === 'patient_get_profile') {
          profileCalls += 1;
          // First call: as if the token were stale -- looks like an
          // ordinary "no matching row" response, not a hard error.
          if (profileCalls === 1) return Promise.resolve({ data: [], error: null });
          return Promise.resolve({ data: [{
            id: 'p1', username: 'maria.huber', name: 'Maria', full_name: 'Maria Huber',
            dob: '1985-01-01', adresse: null, tel: null, email: null,
            versicherung: null, svnr: null, first_login: false,
          }], error: null });
        }
        return origRpc(name, params);
      };
      client.auth.refreshSession = () => Promise.resolve({ data: { session: { user: { id: 'maria.huber' } } }, error: null });
      return client;
    };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(300);

  const profilName = await page.evaluate(() => document.getElementById('profilName').textContent);
  expect(profilName).toBe('Maria Huber');
});

test('genuinely no session anywhere (sessionStorage empty, no real Auth session either) redirects to patient-login.html instead of showing a blank shell', async ({ page }) => {
  // Real user report (2026-08-11): a fresh visitor opening a shared link
  // for the first time landed on what looked like an empty, broken page --
  // this used to render the static demo/fallback markup in place instead
  // of sending them to the login/register screen. Deliberately changed:
  // an earlier version of this test asserted that old fallback-in-place
  // behaviour as correct; it wasn't.
  await installMockSupabase(page, {}, () => {
    window.__mockAuthSession = null;
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForURL('**/patient-login.html', { timeout: 5000 });
  expect(page.url().endsWith('/patient-login.html')).toBe(true);
});
