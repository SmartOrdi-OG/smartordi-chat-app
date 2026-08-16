// Regression test for the practice_settings -> practices consolidation
// (supabase/phase18_practices_consolidation.sql): a brand-new practice's
// name/adresse/tel/plan/trial_start must land directly on its own
// `practices` row (using the name the user actually typed, not a generic
// fallback), and never touch the retired practice_settings table.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('register.html creates one practice with the real typed name and every field, no practice_settings write', async ({ page }) => {
  await installMockSupabase(page, {});
  await page.goto('file://' + path.join(__dirname, '..', 'register.html'));
  await page.waitForTimeout(1000);

  const after = await page.evaluate(async () => {
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
    await doRegister();
    await new Promise(r => setTimeout(r, 300));
    return {
      practices: window.__store.practices,
      staffProfiles: window.__store.staff_profiles,
      practiceSettingsRows: window.__store.practice_settings,
    };
  });

  expect(after.practices).toHaveLength(1);
  expect(after.practices[0].name, 'must use the real typed practice name, not a generic fallback').toBe('Test Ordination');
  expect(after.practices[0].adresse).toBe('Teststraße 1, Linz');
  expect(after.practices[0].tel).toBe('+43 660 1234567');
  expect(after.practices[0].plan).toBeTruthy();
  expect(after.practices[0].trial_start).toBeTruthy();
  expect(after.staffProfiles).toHaveLength(1);
  expect(after.staffProfiles[0].practice_id).toBe(after.practices[0].id);
  expect(after.practiceSettingsRows, 'practice_settings must never be written to').toHaveLength(0);
});

// Real bug found 2026-08-16 during a full walkthrough test: the practices
// insert right after signUp() intermittently failed with a real "new row
// violates row-level security policy". Confirmed via Supabase's own request
// logs (signup 200, then the very next insert 403, shortly after, same
// browser). A FIRST fix attempt (building a second supabase-js client with
// the fresh access_token in its own global.headers.Authorization) looked
// right in code review but was confirmed STILL failing live, unchanged,
// well after that fix had deployed -- supabase-js's own internal session/
// header logic could not be trusted a second time. The real fix bypasses
// the supabase-js client entirely for these two writes: a plain fetch()
// straight to the REST API, with Authorization set by hand to signUp()'s
// own just-returned access_token -- the one and only thing Postgrest
// actually uses to resolve the caller's role for RLS, so this cannot race
// against anything.
test('register.html calls the REST API directly with signUp()\'s own access token for the practices/staff_profiles writes, not through the supabase-js client', async ({ page }) => {
  await installMockSupabase(page, {});
  await page.goto('file://' + path.join(__dirname, '..', 'register.html'));
  await page.waitForTimeout(1000);

  const after = await page.evaluate(async () => {
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
    await doRegister();
    await new Promise(r => setTimeout(r, 300));
    return {
      fetchCalls: window.__fetchCalls,
      practices: window.__store.practices,
      staffProfiles: window.__store.staff_profiles,
    };
  });

  const practicesCall = after.fetchCalls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/practices'));
  const staffProfilesCall = after.fetchCalls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/staff_profiles'));
  expect(practicesCall, 'must go through a real POST fetch(), not sb.from()').toBeTruthy();
  expect(staffProfilesCall, 'must go through a real POST fetch(), not sb.from()').toBeTruthy();
  expect(practicesCall.headers.Authorization, 'must carry signUp()\'s own just-returned access token by hand, never depending on any client\'s ambient session state').toBe('Bearer mock-access-token');
  expect(staffProfilesCall.headers.Authorization).toBe('Bearer mock-access-token');
  expect(practicesCall.headers.apikey).toBeTruthy();

  // The writes themselves must still have gone through correctly.
  expect(after.practices).toHaveLength(1);
  expect(after.practices[0].name).toBe('Test Ordination');
  expect(after.staffProfiles).toHaveLength(1);
  expect(after.staffProfiles[0].practice_id).toBe(after.practices[0].id);
});

// signUp() genuinely returning no session (e.g. email confirmation
// required) must still fall back to the pre-existing sb.from() path --
// there is no access_token to send explicitly, and no race either, since
// no session exists client-side yet at all.
test('register.html falls back to sb.from() when signUp() returns no session', async ({ page }) => {
  await installMockSupabase(page, {});
  await page.goto('file://' + path.join(__dirname, '..', 'register.html'));
  await page.waitForTimeout(1000);

  const after = await page.evaluate(async () => {
    // Overridden here (after page load, not via installMockSupabase's
    // extraInit/addInitScript) since `sb` (vendor/staff-accounts.js) does
    // not exist yet at addInitScript time.
    sb.auth.signUp = () => Promise.resolve({ data: { user: { id: 'new-user-uuid' } }, error: null });
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
    await doRegister();
    await new Promise(r => setTimeout(r, 300));
    return {
      fetchCalls: window.__fetchCalls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/')),
      practices: window.__store.practices,
      staffProfiles: window.__store.staff_profiles,
    };
  });
  expect(after.fetchCalls, 'no session -- must not attempt a direct REST fetch()').toHaveLength(0);
  expect(after.practices).toHaveLength(1);
  expect(after.staffProfiles).toHaveLength(1);
});

// Regression test for a gap found in the 2026-07-29 pricing restructure:
// register.html's own "Paket wählen" plan cards were never updated when
// PLAN_FEATURES was renamed from basic/pro/enterprise to standard/
// enterprise/enterprise_annual -- a brand-new practice registering today
// would have gotten a stale plan:'pro' value written to its row, a key
// that no longer exists anywhere else in the app.
test('register.html writes the current plan keys (standard by default, or whichever card was clicked)', async ({ page }) => {
  await installMockSupabase(page, {});
  await page.goto('file://' + path.join(__dirname, '..', 'register.html'));
  await page.waitForTimeout(1000);

  const defaultPlan = await page.evaluate(() => {
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
    return selectedPlan;
  });
  expect(defaultPlan).toBe('standard');

  await page.evaluate(() => { selectPlan('enterprise_annual'); });
  const cardSelected = await page.evaluate(() => document.getElementById('plan-enterprise_annual').classList.contains('selected'));
  expect(cardSelected).toBe(true);

  await page.evaluate(async () => {
    await doRegister();
    await new Promise(r => setTimeout(r, 300));
  });
  const savedPlan = await page.evaluate(() => window.__store.practices[0].plan);
  expect(savedPlan).toBe('enterprise_annual');
});

test("doctor.html's practice settings read/write resolve to the caller's own practice row, in place", async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed', practice_id: 'prac1' }],
    practices: [{ id: 'prac1', name: 'Ordination Dr. Ahmed', adresse: 'Alte Adresse 1, Linz', tel: '+43 1 111', plan: 'pro', trial_start: '2026-01-01T00:00:00Z', payment_method: null, created_at: '2026-01-01T00:00:00Z' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ u1: { username: 'u1', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    await practiceSettingsReady;
    const loaded = getPracticeSettings();
    const ok = await savePracticeSettings({ adresse: 'Neue Adresse 5, Wien', payment_method: { method: 'card', last4: '1234' } });
    return {
      loadedId: loaded && loaded.id,
      saveOk: ok,
      afterSave: getPracticeSettings(),
      practicesRowCount: window.__store.practices.length,
      practiceSettingsRowCount: window.__store.practice_settings.length,
    };
  });

  expect(result.loadedId, 'must resolve to the caller\'s own practice without an explicit id filter').toBe('prac1');
  expect(result.saveOk).toBe(true);
  expect(result.afterSave.adresse).toBe('Neue Adresse 5, Wien');
  expect(result.afterSave.payment_method.last4).toBe('1234');
  expect(result.practicesRowCount, 'no duplicate practices row').toBe(1);
  expect(result.practiceSettingsRowCount, 'practice_settings must never be touched').toBe(0);
});
