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
