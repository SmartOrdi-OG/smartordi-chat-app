// Regression test for a real report (2026-08-11): a new patient message
// showed an unread badge for the doctor (doctor.html's Kartei rows), but
// secretary.html's Übersicht dashboard had a "Neue Patientennachrichten"
// card that was a static "Keine neuen Nachrichten" placeholder -- it never
// read any real data at all, so a genuinely new message sat there with zero
// signal on the secretary's own dashboard. Now driven by the exact same
// unreadCountFor()/realPatientEntries() data the Patienten list's own
// per-row badges and the nav's aggregate badge already use (see
// renderRealPatientRows()'s own comment in secretary.html).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(messages) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [
      { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' },
      { id: 'p2', username: 'tom.berger', full_name: 'Tom Berger', name: 'Tom', versicherung: 'ÖGK', svnr: '456', dob: '1990-01-01', join_status: 'approved' },
    ],
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

test('shows "Keine neuen Nachrichten" and a zero stat when nothing is unread', async ({ page }) => {
  await setupPage(page, []);
  await expect(page.locator('#uebersichtNachrichtenRoot')).toContainText('Keine neuen Nachrichten');
  await expect(page.locator('#statNachrichten')).toHaveText('0');
});

test('a genuinely new incoming message shows up with sender name, preview and unread count', async ({ page }) => {
  await setupPage(page, []);
  // First-ever view marks existing history read (same one-time rule as
  // chat-unread-count.spec.js) -- simulate a real new message arriving
  // after that point via the realtime-refresh path the app itself uses.
  await page.evaluate(async () => {
    unreadCountFor('p1', loadMessagesForPatientCached('p1'));
    window.__store.patient_messages.push({ id: 'm1', patient_id: 'p1', dir: 'in', type: 'text', text: 'Guten Tag, ich habe eine Frage', created_at: new Date().toISOString() });
    await refreshAllMessages();
    renderRealPatientRows();
  });
  const row = page.locator('.uebersicht-msg-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Maria Huber');
  await expect(row).toContainText('Guten Tag, ich habe eine Frage');
  await expect(row.locator('.mp-badge')).toHaveText('1');
  await expect(page.locator('#statNachrichten')).toHaveText('1');
});

test('clicking a message switches to Patienten, opens that chat, and clears the Übersicht highlight', async ({ page }) => {
  await setupPage(page, []);
  await page.evaluate(async () => {
    unreadCountFor('p1', loadMessagesForPatientCached('p1'));
    window.__store.patient_messages.push({ id: 'm1', patient_id: 'p1', dir: 'in', type: 'text', text: 'Guten Tag', created_at: new Date().toISOString() });
    await refreshAllMessages();
    renderRealPatientRows();
  });
  await page.click('.uebersicht-msg-row');
  await expect(page.locator('#view-patienten')).toHaveClass(/active/);
  await expect(page.locator('#chatName')).toHaveText('Maria Huber');
  await expect(page.locator('#uebersichtNachrichtenRoot')).toContainText('Keine neuen Nachrichten');
  await expect(page.locator('#statNachrichten')).toHaveText('0');
});

test('the "×" button dismisses a message from the list without opening the chat or leaving Übersicht', async ({ page }) => {
  await setupPage(page, []);
  await page.evaluate(async () => {
    unreadCountFor('p1', loadMessagesForPatientCached('p1'));
    window.__store.patient_messages.push({ id: 'm1', patient_id: 'p1', dir: 'in', type: 'text', text: 'Guten Tag', created_at: new Date().toISOString() });
    await refreshAllMessages();
    renderRealPatientRows();
  });
  await page.click('.uebersicht-msg-row button');
  await expect(page.locator('#view-uebersicht')).toHaveClass(/active/);
  await expect(page.locator('#chatName')).not.toHaveText('Maria Huber');
  await expect(page.locator('#uebersichtNachrichtenRoot')).toContainText('Keine neuen Nachrichten');
  await expect(page.locator('#statNachrichten')).toHaveText('0');
  // Dismissing reuses the same "seen" marker openChat() would have set --
  // the message itself must still be intact (not actually deleted).
  const stillThere = await page.evaluate(() => window.__store.patient_messages.some(m => m.id === 'm1'));
  expect(stillThere, 'dismissing from the list must never delete the underlying message/medical record').toBe(true);
});

test('multiple patients with unread messages are all listed, most recent first, and the stat sums every unread count', async ({ page }) => {
  await setupPage(page, []);
  await page.evaluate(async () => {
    unreadCountFor('p1', loadMessagesForPatientCached('p1'));
    unreadCountFor('p2', loadMessagesForPatientCached('p2'));
    // Both timestamps must land AFTER the "seen" marker unreadCountFor() just
    // set (a few ms ago, effectively "now") to count as unread at all -- +1s/
    // +2s from now, not a negative offset into the past.
    window.__store.patient_messages.push(
      { id: 'm1', patient_id: 'p1', dir: 'in', type: 'text', text: 'von Maria zuerst', created_at: new Date(Date.now() + 1000).toISOString() },
      { id: 'm2', patient_id: 'p2', dir: 'in', type: 'text', text: 'von Tom danach', created_at: new Date(Date.now() + 2000).toISOString() },
    );
    await refreshAllMessages();
    renderRealPatientRows();
  });
  const rows = page.locator('.uebersicht-msg-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Tom Berger');
  await expect(rows.nth(1)).toContainText('Maria Huber');
  await expect(page.locator('#statNachrichten')).toHaveText('2');
});
