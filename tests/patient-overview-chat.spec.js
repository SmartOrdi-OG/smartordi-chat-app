// Regression/coverage for the "patient overview instead of auto-opening
// chat" redesign: selecting a patient's name in the Praxis sidebar used to
// immediately render their chat conversation (and silently mark it "read"
// just from being selected). Now it shows an overview (Nächste Termine + a
// "Chat öffnen" button carrying this patient's own unread badge) that stays
// visible for as long as the patient is selected -- the doctor sees
// clinical context first, and opening the chat is one explicit click away,
// via a Messenger-desktop-style floating window layered on top of it
// (selectPatient()/renderPatientOverview()/openPatientChatView()/
// closeFloatingChat() in doctor.html).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  }, extra);
}

async function setupPage(page, extraSeed) {
  await installMockSupabase(page, seed(extraSeed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, allMessagesReady, termineReady]); });
}

test('selecting a patient shows the overview by default, not the chat conversation', async ({ page }) => {
  await setupPage(page);
  const state = await page.evaluate(() => {
    const item = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Maria Huber'));
    item.click();
    return {
      overviewShown: document.getElementById('patientOverviewPane').style.display !== 'none',
      messagesHidden: document.getElementById('messages').style.display === 'none',
      inputHidden: document.getElementById('clinicChatInputArea').style.display === 'none',
    };
  });
  expect(state.overviewShown).toBe(true);
  expect(state.messagesHidden).toBe(true);
  expect(state.inputHidden).toBe(true);
});

test('clicking "Chat öffnen" opens the floating chat window, keeping the overview visible alongside it', async ({ page }) => {
  await setupPage(page);
  const state = await page.evaluate(() => {
    const item = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Maria Huber'));
    item.click();
    openPatientChatView();
    return {
      overviewShown: document.getElementById('patientOverviewPane').style.display !== 'none',
      floatingChatShown: document.getElementById('floatingChatWindow').style.display !== 'none',
      messagesHidden: document.getElementById('messages').style.display === 'none',
      chatNameStillCorrect: document.getElementById('chat-name').textContent === 'Maria Huber',
    };
  });
  expect(state.overviewShown).toBe(true);
  expect(state.floatingChatShown).toBe(true);
  expect(state.messagesHidden).toBe(false);
  expect(state.chatNameStillCorrect).toBe(true);
});

test('closeFloatingChat() closes the floating chat window, back to overview-only', async ({ page }) => {
  await setupPage(page);
  const state = await page.evaluate(() => {
    const item = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Maria Huber'));
    item.click();
    openPatientChatView();
    closeFloatingChat();
    return {
      overviewShown: document.getElementById('patientOverviewPane').style.display !== 'none',
      floatingChatHidden: document.getElementById('floatingChatWindow').style.display === 'none',
      messagesHidden: document.getElementById('messages').style.display === 'none',
    };
  });
  expect(state.overviewShown).toBe(true);
  expect(state.floatingChatHidden).toBe(true);
  expect(state.messagesHidden).toBe(true);
});

test('an unread badge on the sidebar row is NOT cleared just by selecting the patient -- only by opening the chat', async ({ page }) => {
  await setupPage(page);
  const state = await page.evaluate(() => {
    const item = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Maria Huber'));
    // Simulate an unread badge (the real production data source for this is
    // a separate, pre-existing gap unrelated to this feature -- see
    // TODO.md) so this test exercises the read/clear logic itself.
    const meta = item.querySelector('.patient-meta');
    const badge = document.createElement('div');
    badge.className = 'unread-badge';
    badge.textContent = '3';
    meta.appendChild(badge);
    item.click();
    const afterSelect = {
      rowBadgeGone: !item.querySelector('.unread-badge'),
      ovBadgeText: document.getElementById('ovChatBadge').textContent,
      ovBadgeShown: document.getElementById('ovChatBadge').style.display !== 'none',
    };
    openPatientChatView();
    const afterOpen = {
      rowBadgeGone: !item.querySelector('.unread-badge'),
      ovBadgeShown: document.getElementById('ovChatBadge').style.display !== 'none',
    };
    return { afterSelect, afterOpen };
  });
  expect(state.afterSelect.rowBadgeGone, 'the row badge must still be there after merely selecting the patient').toBe(false);
  expect(state.afterSelect.ovBadgeText).toBe('3');
  expect(state.afterSelect.ovBadgeShown).toBe(true);
  expect(state.afterOpen.rowBadgeGone, 'opening the chat must clear the row badge').toBe(true);
  expect(state.afterOpen.ovBadgeShown, 'opening the chat must clear the overview button badge too').toBe(false);
});

test('"Nächste Termine" lists an upcoming appointment for the selected patient', async ({ page }) => {
  const future = new Date(); future.setDate(future.getDate() + 5);
  const futureStr = future.toISOString().slice(0, 10);
  await setupPage(page, {
    termine: [{ id: 't1', patient_name: 'Maria Huber', art: 'Kontrolle', date: futureStr, time: '10:00', status: 'bestaetigt' }],
  });
  const html = await page.evaluate(() => {
    const item = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Maria Huber'));
    item.click();
    return document.getElementById('ovTermineList').innerHTML;
  });
  expect(html).toContain('Kontrolle');
  expect(html).toContain('10:00');
});

test('with no upcoming appointments, the overview says so instead of showing an empty list', async ({ page }) => {
  await setupPage(page);
  const html = await page.evaluate(() => {
    const item = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Maria Huber'));
    item.click();
    return document.getElementById('ovTermineList').innerHTML;
  });
  expect(html).toContain('Keine bevorstehenden Termine');
});

test('a cancelled appointment is not shown as "upcoming"', async ({ page }) => {
  const future = new Date(); future.setDate(future.getDate() + 5);
  const futureStr = future.toISOString().slice(0, 10);
  await setupPage(page, {
    termine: [{ id: 't1', patient_name: 'Maria Huber', art: 'Kontrolle', date: futureStr, time: '10:00', status: 'abgesagt' }],
  });
  const html = await page.evaluate(() => {
    const item = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Maria Huber'));
    item.click();
    return document.getElementById('ovTermineList').innerHTML;
  });
  expect(html).toContain('Keine bevorstehenden Termine');
});

test('switching to a different patient resets back to the overview, even if the previous patient\'s chat was open', async ({ page }) => {
  await setupPage(page, {
    patients: [
      { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' },
      { id: 'p2', username: 'peter.gruber', full_name: 'Peter Gruber', name: 'Peter', versicherung: 'ÖGK', svnr: '456', dob: '1990-01-01', join_status: 'approved' },
    ],
  });
  const state = await page.evaluate(() => {
    const maria = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Maria Huber'));
    maria.click();
    openPatientChatView();
    const peter = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Peter Gruber'));
    peter.click();
    return {
      overviewShown: document.getElementById('patientOverviewPane').style.display !== 'none',
      messagesHidden: document.getElementById('messages').style.display === 'none',
      chatName: document.getElementById('chat-name').textContent,
    };
  });
  expect(state.overviewShown).toBe(true);
  expect(state.messagesHidden).toBe(true);
  expect(state.chatName).toBe('Peter Gruber');
});

test('before any patient is selected, the chat area behaves exactly as before (no overview shown, no forced empty state)', async ({ page }) => {
  await setupPage(page);
  const state = await page.evaluate(() => ({
    overviewShown: document.getElementById('patientOverviewPane').style.display !== 'none',
    messagesHidden: document.getElementById('messages').style.display === 'none',
  }));
  expect(state.overviewShown).toBe(false);
  expect(state.messagesHidden).toBe(false);
});
