// Regression test for supabase/phase34_chat_toggle.sql's per-doctor
// "hide this patient's chat from me" toggle -- only meaningful while the
// practice-wide chat switch is on (tests/chat-toggle-practice-wide.spec.js
// covers that switch itself). Unlike the practice-wide switch, this one is
// personal: hiding a patient's chat only changes what THIS doctor sees --
// a colleague or the secretary keeps using that same conversation normally,
// and Kartei access for that patient is completely unaffected.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
    practices: [{ id: 'prac1', name: 'Test Praxis', chat_enabled: true }],
  };
}

async function setupPage(page, extraStore) {
  await installMockSupabase(page, Object.assign(seed(), extraStore || {}), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, allMessagesReady]); });
}

test('opening a patient with no hidden-chat row shows the normal chat, with an "ausblenden" button', async ({ page }) => {
  await setupPage(page);
  const state = await page.evaluate(() => {
    const item = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Maria Huber'));
    item.click();
    // Selecting a patient now shows the overview pane by default (see
    // doctor.html's selectPatient()/_chatViewMode) -- explicitly open the
    // chat itself before inspecting #messages/the hide button, same as a
    // doctor clicking "Chat öffnen" would.
    openPatientChatView();
    return {
      messagesHidden: document.getElementById('messages').style.display === 'none',
      hiddenNoticeShown: document.getElementById('chatHiddenNotice').style.display === 'flex',
      hideBtnText: document.getElementById('hideChatBtn').textContent,
      hideBtnVisible: document.getElementById('hideChatBtn').style.display !== 'none',
    };
  });
  expect(state.messagesHidden).toBe(false);
  expect(state.hiddenNoticeShown).toBe(false);
  expect(state.hideBtnVisible).toBe(true);
  expect(state.hideBtnText).toContain('ausblenden');
});

test('clicking "Chat ausblenden" hides this patient\'s chat for this doctor and persists it server-side', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    const item = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Maria Huber'));
    item.click();
    openPatientChatView();
    await toggleHideChatForCurrentPatient();
    return {
      messagesHidden: document.getElementById('messages').style.display === 'none',
      inputHidden: document.getElementById('clinicChatInputArea').style.display === 'none',
      hiddenNoticeShown: document.getElementById('chatHiddenNotice').style.display === 'flex',
      hideBtnVisible: document.getElementById('hideChatBtn').style.display !== 'none',
      storedRow: window.__store.doctor_hidden_chats.find(r => r.patient_id === 'p1' && r.arzt_id === 'u1'),
    };
  });
  expect(result.messagesHidden).toBe(true);
  expect(result.inputHidden).toBe(true);
  expect(result.hiddenNoticeShown).toBe(true);
  expect(result.hideBtnVisible, 'the header toggle hides once the empty-state\'s own "einblenden" button is showing').toBe(false);
  expect(result.storedRow).toBeTruthy();
});

test('a patient already hidden (server-confirmed at page load) shows the hidden notice immediately once the chat is opened', async ({ page }) => {
  await setupPage(page, { doctor_hidden_chats: [{ id: 'h1', arzt_id: 'u1', patient_id: 'p1' }] });
  const state = await page.evaluate(async () => {
    await loadHiddenChatsForCurrentDoctor();
    const item = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Maria Huber'));
    item.click();
    openPatientChatView();
    return {
      hiddenNoticeShown: document.getElementById('chatHiddenNotice').style.display === 'flex',
      messagesHidden: document.getElementById('messages').style.display === 'none',
    };
  });
  expect(state.hiddenNoticeShown).toBe(true);
  expect(state.messagesHidden).toBe(true);
});

test('clicking "Chat einblenden" restores the normal chat view and removes the hidden-chat row', async ({ page }) => {
  await setupPage(page, { doctor_hidden_chats: [{ id: 'h1', arzt_id: 'u1', patient_id: 'p1' }] });
  const result = await page.evaluate(async () => {
    await loadHiddenChatsForCurrentDoctor();
    const item = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Maria Huber'));
    item.click();
    openPatientChatView();
    await toggleHideChatForCurrentPatient();
    return {
      messagesHidden: document.getElementById('messages').style.display === 'none',
      hiddenNoticeShown: document.getElementById('chatHiddenNotice').style.display === 'flex',
      hideBtnVisible: document.getElementById('hideChatBtn').style.display !== 'none',
      remainingRows: window.__store.doctor_hidden_chats.filter(r => r.patient_id === 'p1' && r.arzt_id === 'u1').length,
    };
  });
  expect(result.messagesHidden).toBe(false);
  expect(result.hiddenNoticeShown).toBe(false);
  expect(result.hideBtnVisible).toBe(true);
  expect(result.remainingRows).toBe(0);
});

test('hiding one doctor\'s chat does not affect what a colleague (or the secretary) sees for the same patient', async ({ page }) => {
  // A second doctor's own hidden-chat row for a DIFFERENT patient must not
  // leak into/affect this doctor's own hidden set -- confirms the loader
  // actually filters by arzt_id, not just reading the whole table.
  await setupPage(page, { doctor_hidden_chats: [{ id: 'h1', arzt_id: 'u2-someone-else', patient_id: 'p1' }] });
  const state = await page.evaluate(async () => {
    await loadHiddenChatsForCurrentDoctor();
    const item = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Maria Huber'));
    item.click();
    openPatientChatView();
    return {
      messagesHidden: document.getElementById('messages').style.display === 'none',
      hiddenNoticeShown: document.getElementById('chatHiddenNotice').style.display === 'flex',
    };
  });
  expect(state.messagesHidden, 'another doctor\'s own hidden-chat preference must not hide it for this doctor').toBe(false);
  expect(state.hiddenNoticeShown).toBe(false);
});
