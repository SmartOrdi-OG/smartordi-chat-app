// Real user report (2026-08-11): a new self-registration (Beitrittsanfrage)
// only ever showed up in secretary.html after a manual page reload --
// unlike every other list in this app (messages, Termine, Impfungen...),
// which already live-update via their own realtime subscription. Modeled
// on tests/realtime-practice-scoping.spec.js's pattern for the existing
// channels.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'sek1', practice_id: 'prac1' }],
    practices: [{ id: 'prac1', name: 'Ordination Dr. Ahmed', adresse: 'Alte Adresse 1, Linz', tel: '+43 1 111', chat_enabled: true, plan: 'pro', trial_start: '2026-01-01T00:00:00Z', payment_method: null, created_at: '2026-01-01T00:00:00Z' }],
  };
}

test('secretary.html subscribes to patient_join_requests, scoped to this practice', async ({ page }) => {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1500);

  const filter = await page.evaluate(async () => {
    await practiceSettingsReady;
    return window.__realtimeFilters['patient-join-requests-changes'];
  });
  expect(filter).toMatchObject({ event: '*', schema: 'public', table: 'patient_join_requests', filter: 'practice_id=eq.prac1' });
});

test('a new join request arriving over the realtime channel shows up without a manual reload', async ({ page }) => {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    await practiceSettingsReady;
    // Nothing pending yet.
    await renderJoinRequests();
    const before = document.getElementById('joinRequestsList').innerHTML;
    // Simulate the realtime INSERT event arriving -- this app never reads
    // the event payload itself, it just re-queries fresh (see
    // subscribeJoinRequestsRealtime()'s own comment), so pushing the row
    // into the mock store directly and firing the handler is enough.
    window.__store.patient_join_requests.push({
      id: 'jr-live', username: 'live.patient', vorname: 'Live', nachname: 'Patient',
      full_name: 'Live Patient', adresse: 'Teststr 1', svnr: '1234567890',
      pw_hash: 'h', status: 'pending', submitted_at: new Date().toISOString(),
    });
    // secretary.html's onChange callback (renderJoinRequests();
    // updateJoinRequestsBadge();) is fire-and-forget, not awaited itself --
    // awaiting the handler call alone resolves before that work finishes,
    // so give it a beat the same way this codebase's other realtime tests do.
    window.__realtimeHandlers['patient-join-requests-changes']();
    await new Promise(r => setTimeout(r, 300));
    const after = document.getElementById('joinRequestsList').innerHTML;
    return { before, after };
  });
  expect(result.before).not.toContain('Live Patient');
  expect(result.after).toContain('Live Patient');
});

test('the realtime handler also refreshes the Beitrittsanfragen badge count', async ({ page }) => {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    await practiceSettingsReady;
    window.__store.patient_join_requests.push({
      id: 'jr-live2', username: 'live.patient2', vorname: 'Live', nachname: 'Two',
      full_name: 'Live Two', adresse: 'Teststr 1', svnr: '1234567891',
      pw_hash: 'h', status: 'pending', submitted_at: new Date().toISOString(),
    });
    window.__realtimeHandlers['patient-join-requests-changes']();
    await new Promise(r => setTimeout(r, 300));
    const badge = document.getElementById('joinReqBadge');
    return { badgeText: badge ? badge.textContent : null, badgeVisible: badge ? getComputedStyle(badge).display !== 'none' : false };
  });
  expect(result.badgeVisible).toBe(true);
  expect(result.badgeText).toContain('1');
});
