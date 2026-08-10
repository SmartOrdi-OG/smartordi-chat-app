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

const PROFILE_ROW = {
  id: 'p1', username: 'maria.huber', name: 'Maria', full_name: 'Maria Huber',
  dob: '1985-01-01', adresse: null, tel: null, email: null,
  versicherung: null, svnr: null, first_login: false,
};

test('sessionStorage empty but a real Supabase Auth session is still valid -- rehydrates silently instead of looking logged out', async ({ page }) => {
  await installMockSupabase(page, {}, () => {
    // sessionStorage.smartordi_user is deliberately left unset -- this is
    // the "tab relaunch"/"storage eviction" case, not a normal load.
    window.__mockAuthSession = { user: { id: 'maria.huber' } };
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.evaluate((row) => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [row], error: null });
      return Promise.resolve({ data: [], error: null });
    };
  }, PROFILE_ROW);
  await page.evaluate(() => initPatientData());
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
  await installMockSupabase(page, {}, () => {
    window.__mockAuthSession = { user: { id: 'maria.huber' } };
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.evaluate((row) => {
    let profileCalls = 0;
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') {
        profileCalls += 1;
        // First call: as if the token were stale -- looks like an
        // ordinary "no matching row" response, not a hard error.
        if (profileCalls === 1) return Promise.resolve({ data: [], error: null });
        return Promise.resolve({ data: [row], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    };
    sb.auth.refreshSession = () => Promise.resolve({ data: { session: { user: { id: 'maria.huber' } } }, error: null });
  }, PROFILE_ROW);
  await page.evaluate(() => initPatientData());
  await page.waitForTimeout(300);

  const profilName = await page.evaluate(() => document.getElementById('profilName').textContent);
  expect(profilName).toBe('Maria Huber');
});

test('genuinely no session anywhere (sessionStorage empty, no real Auth session either) still falls back gracefully -- never a crash', async ({ page }) => {
  await installMockSupabase(page, {}, () => {
    window.__mockAuthSession = null;
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(500);
  // FALLBACK_MESSAGES is deliberately empty -- an empty chat pane here is
  // correct, honest "not logged in" behaviour, not a bug. The point of
  // this test is that reaching this state doesn't throw/crash and the
  // page stays interactive (Home screen still renders, no visible error
  // banner for a plain logged-out visitor).
  const state = await page.evaluate(() => ({
    homeVisible: document.getElementById('view-home').classList.contains('active'),
    bannerDisplay: getComputedStyle(document.getElementById('dataLoadErrorBanner')).display,
  }));
  expect(state.homeVisible).toBe(true);
  expect(state.bannerDisplay).toBe('none');
});
