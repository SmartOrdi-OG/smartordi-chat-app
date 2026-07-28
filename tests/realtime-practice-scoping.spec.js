// Regression test for a performance-audit finding: every realtime
// postgres_changes subscription (termine, patient_messages,
// patient_impfungen, practices, lab_result_uploads) had no practice_id
// filter at all -- in a deployment with many practices sharing the same
// tables, every open doctor.html/secretary.html tab in every practice
// re-fetched on every OTHER practice's row change. Each subscribeXRealtime()
// now waits for practiceSettingsReady and passes a `filter` scoped to this
// practice's own id (RLS still applies regardless -- this only avoids
// wasted round-trips, it changes no access control).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'u1', practice_id: 'prac1' }],
    practices: [{ id: 'prac1', name: 'Ordination Dr. Ahmed', adresse: 'Alte Adresse 1, Linz', tel: '+43 1 111', chat_enabled: true, plan: 'pro', trial_start: '2026-01-01T00:00:00Z', payment_method: null, created_at: '2026-01-01T00:00:00Z' }],
  };
}

test('doctor.html: every realtime channel is scoped to this practice_id (or, for practices itself, its own id)', async ({ page }) => {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ u1: { username: 'u1', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1500);

  const filters = await page.evaluate(async () => {
    await practiceSettingsReady;
    return window.__realtimeFilters;
  });

  expect(filters['termine-changes']).toMatchObject({ event: '*', schema: 'public', table: 'termine', filter: 'practice_id=eq.prac1' });
  expect(filters['patient-messages-changes']).toMatchObject({ event: '*', schema: 'public', table: 'patient_messages', filter: 'practice_id=eq.prac1' });
  expect(filters['patient-impfungen-changes']).toMatchObject({ event: '*', schema: 'public', table: 'patient_impfungen', filter: 'practice_id=eq.prac1' });
  expect(filters['practice-settings-changes']).toMatchObject({ event: '*', schema: 'public', table: 'practices', filter: 'id=eq.prac1' });
  expect(filters['lab-result-uploads-changes']).toMatchObject({ event: '*', schema: 'public', table: 'lab_result_uploads', filter: 'practice_id=eq.prac1' });
});

test('secretary.html: the channels it also subscribes to are scoped the same way', async ({ page }) => {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1500);

  const filters = await page.evaluate(async () => {
    await practiceSettingsReady;
    return window.__realtimeFilters;
  });

  expect(filters['termine-changes']).toMatchObject({ table: 'termine', filter: 'practice_id=eq.prac1' });
  expect(filters['patient-messages-changes']).toMatchObject({ table: 'patient_messages', filter: 'practice_id=eq.prac1' });
  expect(filters['practice-settings-changes']).toMatchObject({ table: 'practices', filter: 'id=eq.prac1' });
});

test('the realtime channels still work correctly (still fire onChange) even though they now wait for practiceSettingsReady first', async ({ page }) => {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ u1: { username: 'u1', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    await practiceSettingsReady;
    window.__store.practices[0].chat_enabled = false;
    await window.__realtimeHandlers['practice-settings-changes']();
    return isChatEnabled();
  });
  expect(result).toBe(false);
});
