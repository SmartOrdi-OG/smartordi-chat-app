// Regression test for a real bug report: a brand-new message's notification
// in secretary.html's Übersicht "Neue Nachrichten" card could show once,
// then vanish on its own within seconds -- no click, and with no other
// message involved. Root cause: unreadCountFor()'s "never seen this
// patientKey before" branch used to seed the "last viewed" marker with
// `new Date().toISOString()` -- a fresh "now" every time it ran. Because
// renderRealPatientRows() fires from several independent triggers shortly
// after a real message arrives, and accountToPatientEntry() can resolve
// patientKey differently across those (falls back from a.id to a.fullName
// when the real Supabase id hasn't synced into the local cache yet), the
// SAME patient's very first message could hit this "never seen" branch
// more than once under different keys -- each time re-seeding to a fresh
// "now" and silently swallowing the message that had just made it show as
// unread. Fixed by anchoring the cold-start seed to one timestamp captured
// once at page load (SEC_SESSION_START) instead of a fresh "now" per call.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
    patient_messages: [],
  };
}

async function setupPage(page) {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, allMessagesReady]); });
}

test('a genuinely new message stays counted as unread even if unreadCountFor() first sees it under one patientKey, then a different one', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(() => {
    // A message that arrived just now, well after SEC_SESSION_START (page
    // load happened well over a second ago per the test's own waitForTimeout).
    const messages = [{ dir: 'in', text: 'gerade eingetroffen', createdAt: new Date().toISOString() }];
    // First render resolves patientKey as the fallback (id not yet synced).
    const firstCount = unreadCountFor('maria-fallback-name-key', messages);
    // A later render resolves the SAME real patient under their real id --
    // a genuinely different key, hitting the "never seen" branch again.
    const secondCount = unreadCountFor('p1', messages);
    return { firstCount, secondCount };
  });
  expect(result.firstCount, 'must show as unread the first time it is ever computed').toBe(1);
  expect(result.secondCount, 'must STILL show as unread under a different key -- this is the flicker bug').toBe(1);
});

test('a patient\'s pre-existing message history still does not flood in as unread the first time this feature sees them', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(() => {
    const oldMessages = [
      { dir: 'in', text: 'alt 1', createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
      { dir: 'in', text: 'alt 2', createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
    ];
    return unreadCountFor('synthetic-old-history-only', oldMessages);
  });
  expect(result).toBe(0);
});
