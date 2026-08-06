// Feature test for secretary.html's Messenger-style floating chat popup --
// on request ("عم فكر نعمل الشات زي عند الدكتور", 2026-08-06), following a
// real user report that the chat pane stretched edge-to-edge and looked
// empty on a wide monitor. Mirrors doctor.html's own floating-chat redesign
// (overview pane shown first, conversation opens on demand as a small
// fixed-position popup) but keeps secretary.html's own header actions
// (Aktionen/Bearbeiten) instead of porting Weiterleiten/Überweisen, which
// are clinical workflows a secretary doesn't perform.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  }, extra);
}

async function setupPage(page, extra) {
  await installMockSupabase(page, seed(extra), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, allMessagesReady, termineReady]); renderRealPatientRows(); });
  await page.click('.nav-tab[data-view="patienten"]');
  await page.waitForTimeout(200);
}

test('selecting a patient shows the overview pane (Nächste Termine) with the popup closed, not the conversation directly', async ({ page }) => {
  await setupPage(page, {
    termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: '2026-09-01', time: '10:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() }],
  });
  await page.click('#patientList .patient-row[data-real]:has-text("Maria Huber")');
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => ({
    overviewDisplay: getComputedStyle(document.getElementById('secOverviewPane')).display,
    floatingDisplay: getComputedStyle(document.getElementById('secFloatingChatWindow')).display,
    overviewText: document.getElementById('secOvTermineList').textContent,
  }));
  expect(state.overviewDisplay).not.toBe('none');
  expect(state.floatingDisplay).toBe('none');
  expect(state.overviewText).toContain('Kontrolle');
});

test('clicking "Chat öffnen" opens the floating popup with that patient\'s name/avatar and the conversation', async ({ page }) => {
  await setupPage(page, {
    patient_messages: [{ id: 'm1', patient_id: 'p1', dir: 'in', type: 'text', text: 'Hallo!', created_at: new Date().toISOString() }],
  });
  await page.click('#patientList .patient-row[data-real]:has-text("Maria Huber")');
  await page.waitForTimeout(300);
  await page.click('#secChatOpenBtn');
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => ({
    floatingDisplay: getComputedStyle(document.getElementById('secFloatingChatWindow')).display,
    fcwName: document.getElementById('secFcwName').textContent,
    messagesText: document.getElementById('chatMessages').textContent,
  }));
  expect(state.floatingDisplay).not.toBe('none');
  expect(state.fcwName).toBe('Maria Huber');
  expect(state.messagesText).toContain('Hallo!');
});

test('the × button closes the floating popup without losing the overview underneath', async ({ page }) => {
  await setupPage(page);
  await page.click('#patientList .patient-row[data-real]:has-text("Maria Huber")');
  await page.waitForTimeout(300);
  await page.click('#secChatOpenBtn');
  await page.waitForTimeout(200);
  await page.click('.floating-chat-close');
  await page.waitForTimeout(200);
  const state = await page.evaluate(() => ({
    floatingDisplay: getComputedStyle(document.getElementById('secFloatingChatWindow')).display,
    overviewDisplay: getComputedStyle(document.getElementById('secOverviewPane')).display,
  }));
  expect(state.floatingDisplay).toBe('none');
  expect(state.overviewDisplay).not.toBe('none');
});

test('selecting a second patient closes any already-open popup instead of silently carrying the previous conversation over', async ({ page }) => {
  await setupPage(page, {
    patients: [
      { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' },
      { id: 'p2', username: 'karl.gruber', full_name: 'Karl Gruber', name: 'Karl', versicherung: 'ÖGK', svnr: '456', dob: '1970-02-02', join_status: 'approved' },
    ],
  });
  await page.click('#patientList .patient-row[data-real]:has-text("Maria Huber")');
  await page.waitForTimeout(200);
  await page.click('#secChatOpenBtn');
  await page.waitForTimeout(200);
  await page.click('#patientList .patient-row[data-real]:has-text("Karl Gruber")');
  await page.waitForTimeout(200);
  const floatingDisplay = await page.evaluate(() => getComputedStyle(document.getElementById('secFloatingChatWindow')).display);
  expect(floatingDisplay, 'the popup must close on re-selection, requiring an explicit re-open for the newly selected patient').toBe('none');
});

test('sending a message from the floating popup still works and appears instantly', async ({ page }) => {
  await setupPage(page);
  await page.click('#patientList .patient-row[data-real]:has-text("Maria Huber")');
  await page.waitForTimeout(200);
  await page.click('#secChatOpenBtn');
  await page.waitForTimeout(200);
  await page.fill('#secChatInput', 'Ihr Termin ist bestätigt');
  await page.click('.floating-chat-window .send-btn');
  await page.waitForTimeout(200);
  const messagesText = await page.evaluate(() => document.getElementById('chatMessages').textContent);
  expect(messagesText).toContain('Ihr Termin ist bestätigt');
});

test('the "Aktionen"/"Bearbeiten" header buttons still work from the overview pane (no Weiterleiten/Überweisen ported over)', async ({ page }) => {
  await setupPage(page);
  await page.click('#patientList .patient-row[data-real]:has-text("Maria Huber")');
  await page.waitForTimeout(200);
  const menuItems = await page.evaluate(() => [...document.querySelectorAll('#chatAttestActionsMenu .rail-btn')].map(b => b.textContent.trim()));
  expect(menuItems).toEqual(['Pflegefreistellung ausstellen', 'Arbeitsunfähigkeit ausstellen']);
  expect(menuItems.join(' ')).not.toContain('Weiterleiten');
  expect(menuItems.join(' ')).not.toContain('Überweisen');
});

// Real user report (2026-08-06): a patient with no upcoming Termine left
// the overview pane mostly empty above the chat button -- doctor.html's
// own overview fills that space with Weiterleiten/Überweisen, which don't
// apply to a secretary. A "Patientendaten" card (Versicherung/SV-Nummer/
// Telefon/Adresse) fills it with genuinely useful reference instead.
test('the overview pane shows a "Patientendaten" card with the selected patient\'s own contact/insurance details', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '1234140385', dob: '1985-01-01', adresse: 'Steingasse 6A, 4020 Linz', tel: '+43 660 1234567', join_status: 'approved' }],
  });
  await page.click('#patientList .patient-row[data-real]:has-text("Maria Huber")');
  await page.waitForTimeout(300);
  const infoText = await page.evaluate(() => document.getElementById('secOvPatientInfo').textContent);
  expect(infoText).toContain('ÖGK');
  expect(infoText).toContain('1234140385');
  expect(infoText).toContain('+43 660 1234567');
  expect(infoText).toContain('Steingasse 6A, 4020 Linz');
});

test('the "Patientendaten" card only lists fields that are actually on file, and falls back to a plain message when none are', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: '', svnr: '', dob: '1985-01-01', adresse: '', tel: '', join_status: 'approved' }],
  });
  await page.click('#patientList .patient-row[data-real]:has-text("Maria Huber")');
  await page.waitForTimeout(300);
  const infoText = await page.evaluate(() => document.getElementById('secOvPatientInfo').textContent);
  expect(infoText).toContain('Keine Angaben hinterlegt');
});
