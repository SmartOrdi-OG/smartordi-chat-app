// Regression test for supabase/phase34_chat_toggle.sql's practice-wide
// "Chat aktivieren" switch (doctor.html Einstellungen). Came out of a user
// question: what happens if a doctor doesn't want to use the Praxis-Chat at
// all? Since the chat is one shared conversation per patient (not a
// separate one per doctor), disabling it is practice-wide, not per-doctor
// -- it must affect the patient, doctor.html, and secretary.html alike.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function staffAndPatients() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  };
}

test('doctor.html: disabling chat in Einstellungen locks the Praxis nav tab and swaps the chat pane for a notice', async ({ page }) => {
  await installMockSupabase(page, Object.assign(staffAndPatients(), {
    practices: [{ id: 'prac1', name: 'Test Praxis', chat_enabled: true }],
  }), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const before = await page.evaluate(() => ({
    navLocked: document.getElementById('navTabPraxis').classList.contains('nav-tab-locked'),
    checkboxChecked: document.getElementById('setChatEnabled').checked,
    messagesHidden: document.getElementById('messages').style.display === 'none',
  }));
  expect(before.navLocked).toBe(false);
  expect(before.checkboxChecked).toBe(true);
  expect(before.messagesHidden).toBe(false);

  const result = await page.evaluate(async () => {
    document.getElementById('setChatEnabled').checked = false;
    await savePracticeSettings({ chat_enabled: false });
    applyChatGating();
    return {
      navLocked: document.getElementById('navTabPraxis').classList.contains('nav-tab-locked'),
      hasLockIcon: !!document.getElementById('navTabPraxis').querySelector('.tab-lock'),
      disabledNoticeShown: document.getElementById('chatDisabledNotice').style.display === 'flex',
      messagesHidden: document.getElementById('messages').style.display === 'none',
      inputHidden: document.getElementById('clinicChatInputArea').style.display === 'none',
      savedRow: window.__store.practices[0].chat_enabled,
    };
  });
  expect(result.navLocked).toBe(true);
  expect(result.hasLockIcon).toBe(true);
  expect(result.disabledNoticeShown).toBe(true);
  expect(result.messagesHidden).toBe(true);
  expect(result.inputHidden).toBe(true);
  expect(result.savedRow).toBe(false);
});

test('doctor.html: sendClinicMsg() is a no-op while chat is disabled, even if called directly', async ({ page }) => {
  await installMockSupabase(page, Object.assign(staffAndPatients(), {
    practices: [{ id: 'prac1', name: 'Test Praxis', chat_enabled: false }],
  }), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const messageCountBefore = await page.evaluate(() => window.__store.patient_messages.length);
  await page.evaluate(() => {
    document.getElementById('clinicInput').value = 'sollte nicht gesendet werden';
    sendClinicMsg();
  });
  const messageCountAfter = await page.evaluate(() => window.__store.patient_messages.length);
  expect(messageCountAfter).toBe(messageCountBefore);
});

test('secretary.html: chat disabled shows a notice and blocks sending', async ({ page }) => {
  await installMockSupabase(page, Object.assign(staffAndPatients(), {
    practices: [{ id: 'prac1', name: 'Test Praxis', chat_enabled: false }],
  }), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);

  const state = await page.evaluate(() => ({
    noticeShown: document.getElementById('secChatDisabledNotice').style.display === 'flex',
    messagesHidden: document.getElementById('chatMessages').style.display === 'none',
    inputHidden: document.getElementById('secChatInputArea').style.display === 'none',
  }));
  expect(state.noticeShown).toBe(true);
  expect(state.messagesHidden).toBe(true);
  expect(state.inputHidden).toBe(true);

  const messageCountBefore = await page.evaluate(() => window.__store.patient_messages.length);
  await page.evaluate(() => {
    document.getElementById('chatName').textContent = 'Maria Huber';
    document.getElementById('secChatInput').value = 'sollte nicht gesendet werden';
    sendSecChatMsg();
  });
  const messageCountAfter = await page.evaluate(() => window.__store.patient_messages.length);
  expect(messageCountAfter).toBe(messageCountBefore);
});

test('patient.html: chat disabled by the practice shows "nicht verfügbar" instead of the normal chat, and blocks sending', async ({ page }) => {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [{ id: 'p1', username: 'maria', name: 'Maria', full_name: 'Maria Huber', dob: '1985-01-01', first_login: false }], error: null });
      if (name === 'patient_get_chat_enabled') return Promise.resolve({ data: false, error: null });
      if (name === 'patient_send_message') return Promise.resolve({ data: null, error: { message: 'should not be called' } });
      return Promise.resolve({ data: [], error: null });
    };
  });
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => ({
    messagesText: document.getElementById('messages').textContent,
    inputHidden: document.getElementById('chatInputArea').style.display === 'none',
  }));
  expect(state.messagesText).toContain('nicht verfügbar');
  expect(state.inputHidden).toBe(true);

  const sendResult = await page.evaluate(async () => {
    document.getElementById('chatInput').value = 'sollte nicht gesendet werden';
    await sendMsg();
    return document.getElementById('messages').textContent;
  });
  expect(sendResult, 'a blocked send must not even optimistically render the attempted message').not.toContain('sollte nicht gesendet werden');
});

test('patient.html: chat enabled (the default) shows the normal empty state, not the disabled notice', async ({ page }) => {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [{ id: 'p1', username: 'maria', name: 'Maria', full_name: 'Maria Huber', dob: '1985-01-01', first_login: false }], error: null });
      if (name === 'patient_get_chat_enabled') return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: [], error: null });
    };
  });
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => ({
    messagesText: document.getElementById('messages').textContent,
    inputHidden: document.getElementById('chatInputArea').style.display === 'none',
  }));
  expect(state.messagesText).toContain('Noch keine Nachrichten');
  expect(state.inputHidden).toBe(false);
});
