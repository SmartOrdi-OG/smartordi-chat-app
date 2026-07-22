// Regression tests for the merged "Patienten"/"Nachrichten" tab in
// secretary.html: one patient list now doubles as the chat inbox (a single
// row's click opens that patient's chat instead of a separate nav tab), and
// its search box was extended to also match the SV-Nummer, not just the
// name. Neither of these had any committed test coverage before -- both
// shipped behind ad-hoc scratchpad Playwright scripts that were discarded
// once verified live, so a future edit could silently regress either one.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true, adresse: 'Steingasse 6A, 4020 Linz', tel: '+43 677 62439293', plan: 'pro' }],
    patients: [
      { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '1234140385', dob: '1985-01-01', join_status: 'approved' },
      { id: 'p2', username: 'ahmad.saadat', full_name: 'Ahmad Saadat', name: 'Ahmad', versicherung: 'BVAEB', svnr: '5678220190', dob: '1990-02-02', join_status: 'approved' },
    ],
  };
}

async function setupPage(page, viewport) {
  if (viewport) await page.setViewportSize(viewport);
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, allMessagesReady]); renderRealPatientRows(); });
}

test('there is no separate Nachrichten nav tab, and Patienten is the only entry point', async ({ page }) => {
  await setupPage(page);
  const views = await page.evaluate(() => [...document.querySelectorAll('.nav-tab')].map(t => t.dataset.view));
  expect(views).toContain('patienten');
  expect(views).not.toContain('nachrichten');
});

test('filterPatients() matches by SV-Nummer as well as by name', async ({ page }) => {
  await setupPage(page);

  const visibleNamesFor = async (query) => page.evaluate((q) => {
    filterPatients(q);
    return [...document.querySelectorAll('#patientList .patient-row[data-real]')]
      .filter(r => r.style.display !== 'none')
      .map(r => r.querySelector('.p-name').textContent);
  }, query);

  expect(await visibleNamesFor('maria')).toEqual(['Maria Huber']);
  expect(await visibleNamesFor('1234140385')).toEqual(['Maria Huber']);
  expect(await visibleNamesFor('5678220190')).toEqual(['Ahmad Saadat']);
  expect(await visibleNamesFor('no-such-match')).toEqual([]);
  expect(await visibleNamesFor('')).toHaveLength(2);
});

test('desktop: clicking a patient row opens their chat and keeps the list pane visible', async ({ page }) => {
  await setupPage(page, { width: 1920, height: 1080 });

  await page.click('.nav-tab[data-view="patienten"]');
  await page.waitForTimeout(200);
  await page.click('#patientList .patient-row[data-real]:has-text("Maria Huber")');
  await page.waitForTimeout(200);

  const state = await page.evaluate(() => ({
    chatName: document.getElementById('chatName').textContent,
    chatOpen: document.getElementById('nachrichtenSplit').classList.contains('chat-open'),
    listPaneDisplay: getComputedStyle(document.querySelector('.nachrichten-list-pane')).display,
    chatPaneDisplay: getComputedStyle(document.querySelector('.nachrichten-chat-pane')).display,
  }));

  expect(state.chatName).toBe('Maria Huber');
  expect(state.chatOpen).toBe(true);
  expect(state.listPaneDisplay, 'list pane must stay visible on desktop even with a chat open').not.toBe('none');
  expect(state.chatPaneDisplay).not.toBe('none');
});

test('mobile: clicking a patient row opens their chat and hides the list pane behind it', async ({ page }) => {
  await setupPage(page, { width: 390, height: 844 });

  await page.click('#nav-patienten');
  await page.waitForTimeout(200);
  await page.click('#patientList .patient-row[data-real]:has-text("Maria Huber")');
  await page.waitForTimeout(200);

  const state = await page.evaluate(() => ({
    chatName: document.getElementById('chatName').textContent,
    listPaneDisplay: getComputedStyle(document.querySelector('.nachrichten-list-pane')).display,
    chatPaneDisplay: getComputedStyle(document.querySelector('.nachrichten-chat-pane')).display,
  }));

  expect(state.chatName).toBe('Maria Huber');
  expect(state.listPaneDisplay, 'mobile has no room for both panes -- the list must hide once a chat opens').toBe('none');
  expect(state.chatPaneDisplay).not.toBe('none');

  // The mobile-only back button must restore the list.
  await page.click('.nachrichten-chat-back');
  await page.waitForTimeout(200);
  const listPaneAfterBack = await page.evaluate(() => getComputedStyle(document.querySelector('.nachrichten-list-pane')).display);
  expect(listPaneAfterBack).not.toBe('none');
});
