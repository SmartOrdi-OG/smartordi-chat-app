// Regression test for secretary.html's per-patient unread-message tracking
// (CHAT_LAST_VIEWED_KEY / loadChatLastViewedMap / markChatViewed /
// unreadCountFor) -- secretary.html had no notification at all for a new
// patient message before this existed, so a message could arrive and sit
// invisible unless the secretary happened to open that exact chat. None of
// this had test coverage before: the deliberate "first-ever view marks
// everything up-to-now as read instead of flooding every existing
// conversation as unread" rule (see this feature's own header comment in
// secretary.html) is exactly the kind of one-time, easy-to-silently-break
// edge case a future refactor could regress without anyone noticing.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(messages) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
    patient_messages: messages || [],
  };
}

async function setupPage(page, messages) {
  await installMockSupabase(page, seed(messages), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, allMessagesReady]); });
}

test('unreadCountFor() marks a never-before-seen patient as read instead of flooding their existing history as unread', async ({ page }) => {
  // Uses a patientKey with no corresponding seeded patient, on purpose --
  // secretary.html's own page-load chain (Promise.all([patientsReady,
  // allMessagesReady]).then(renderRealPatientRows)) already calls
  // unreadCountFor() for every REAL patient as soon as the page loads (to
  // render their badge), which would otherwise mark 'p1' viewed before this
  // test ever gets to make its own "first-ever check" assertion.
  await setupPage(page, []);
  const result = await page.evaluate(() => {
    const messages = [
      { dir: 'in', text: 'alt 1', createdAt: new Date(Date.now() - 60000).toISOString() },
      { dir: 'in', text: 'alt 2', createdAt: new Date(Date.now() - 30000).toISOString() },
    ];
    const before = loadChatLastViewedMap()['synthetic-never-seen'];
    const count = unreadCountFor('synthetic-never-seen', messages);
    const after = loadChatLastViewedMap()['synthetic-never-seen'];
    return { before, count, markedAfterFirstCall: !!after };
  });
  expect(result.before, 'no marker should exist yet for a patient never seen on this device').toBeUndefined();
  expect(result.count, 'first-ever check must not flood pre-existing history as unread').toBe(0);
  expect(result.markedAfterFirstCall, 'the first check must persist a viewed marker so it is not "first ever" again next time').toBe(true);
});

test('unreadCountFor() only counts incoming messages received after the last-viewed marker', async ({ page }) => {
  await setupPage(page, []);
  const result = await page.evaluate(() => {
    const lastViewed = new Date(Date.now() - 60000).toISOString();
    localStorage.setItem('smartordi_sec_chat_last_viewed', JSON.stringify({ p1: lastViewed }));
    const messages = [
      { dir: 'in', text: 'before, incoming', createdAt: new Date(Date.now() - 120000).toISOString() },
      { dir: 'in', text: 'after, incoming', createdAt: new Date(Date.now() - 30000).toISOString() },
      { dir: 'out', text: 'after, but outgoing (secretary’s own reply)', createdAt: new Date(Date.now() - 10000).toISOString() },
    ];
    return unreadCountFor('p1', messages);
  });
  expect(result, 'only the one incoming message after last-viewed should count -- not the older incoming one, and never an outgoing one').toBe(1);
});

test('realPatientEntries() reports the correct unread badge, and opening the chat clears it back to zero', async ({ page }) => {
  await setupPage(page, [
    { id: 'm1', patient_id: 'p1', dir: 'in', type: 'text', text: 'first message ever', created_at: new Date(Date.now() - 500000).toISOString() },
  ]);
  const initial = await page.evaluate(() => {
    // First-ever view of this patient marks the existing message as read (0
    // unread) -- simulate a genuinely new incoming message arriving after
    // that point, same as unreadCountFor()'s own second test above but
    // through the real integration path used by the rendered list.
    unreadCountFor('p1', loadMessagesForPatientCached('p1'));
    const newMsg = { id: 'm2', patient_id: 'p1', dir: 'in', type: 'text', text: 'new incoming', created_at: new Date().toISOString() };
    window.__store.patient_messages.push(newMsg);
    return refreshAllMessages().then(() => realPatientEntries().find(e => e.name === 'Maria Huber').unreadCount);
  });
  expect(initial, 'a genuinely new incoming message after the last-viewed marker must show up as unread').toBe(1);

  const afterOpen = await page.evaluate(async () => {
    await openChat('Maria Huber', '#000');
    return realPatientEntries().find(e => e.name === 'Maria Huber').unreadCount;
  });
  expect(afterOpen, 'opening the chat must clear the unread badge back to zero').toBe(0);
});
