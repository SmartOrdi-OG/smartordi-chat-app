// Real user feedback (2026-08-11), item 1: clicking a message in the
// Übersicht already opened the right chat directly (see
// uebersicht-neue-nachrichten.spec.js's own "clicking a message switches to
// Patienten, opens that chat" test) -- the actual complaint was the
// perceived delay before the chat pane appeared at all, since openChat()
// used to only switch the pane over once realThreadFromSupabase()'s network
// round-trip had resolved. It now switches over immediately with whatever's
// cached locally as a placeholder, then repaints once the real thread has
// actually loaded.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(messages) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [
      { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' },
    ],
    patient_messages: messages || [],
  };
}

async function setupPage(page) {
  await installMockSupabase(page, seed([]), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, allMessagesReady]); });
}

test('the chat pane switches over immediately on click, before the message fetch has resolved', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(async () => {
    unreadCountFor('p1', loadMessagesForPatientCached('p1'));
    window.__store.patient_messages.push({ id: 'm1', patient_id: 'p1', dir: 'in', type: 'text', text: 'Guten Tag', created_at: new Date().toISOString() });
    await refreshAllMessages();
    renderRealPatientRows();
    // Simulate a slow connection: getMessagesForPatient() (called from
    // realThreadFromSupabase(), called from openChat()) never resolves
    // within this test's lifetime.
    window.__origGetMessagesForPatient = window.getMessagesForPatient;
    window.getMessagesForPatient = () => new Promise(() => {});
  });
  await page.click('.uebersicht-msg-row');
  // Deliberately NOT waiting for openChat()'s in-flight fetch (which never
  // resolves) -- the pane must already have switched over synchronously.
  const state = await page.evaluate(() => ({
    chatOpenClass: document.getElementById('nachrichtenSplit').classList.contains('chat-open'),
    chatName: document.getElementById('chatName').textContent,
    activeView: document.querySelector('.view.active')?.id,
  }));
  expect(state.chatOpenClass).toBe(true);
  expect(state.chatName).toBe('Maria Huber');
  expect(state.activeView).toBe('view-patienten');
});

test('once the delayed fetch resolves, the real thread still repaints on top of the placeholder', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(async () => {
    unreadCountFor('p1', loadMessagesForPatientCached('p1'));
    window.__store.patient_messages.push({ id: 'm1', patient_id: 'p1', dir: 'in', type: 'text', text: 'Guten Tag, verzögert', created_at: new Date().toISOString() });
    await refreshAllMessages();
    renderRealPatientRows();
    const orig = window.getMessagesForPatient;
    window.getMessagesForPatient = async (id) => {
      await new Promise(r => setTimeout(r, 400));
      return orig(id);
    };
  });
  await page.click('.uebersicht-msg-row');
  await page.waitForTimeout(700);
  await expect(page.locator('#chatMessages')).toContainText('Guten Tag, verzögert');
});
