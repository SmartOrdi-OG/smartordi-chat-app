// Real gap found via a launch-readiness pass (see TODO.md): recall lists
// (proactive rebooking of overdue chronic-condition patients) turned out to
// be a standard feature at established competitors, not a differentiator --
// but SmartOrdi didn't have one at all. detectFollowupReminder() (vendor/
// cdss-followup-reminders.js) already existed, wired into doctor.html's
// Kartei, but only ever ran on whichever ONE patient's chart happened to be
// open. computeRecallList()/renderUebersichtRecall() (secretary.html) run
// the exact same check across every patient in the practice at once, so a
// chronic patient who simply never got rebooked doesn't stay invisible.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [
      { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' },
      { id: 'p2', username: 'karl.gruber', full_name: 'Karl Gruber', name: 'Karl', versicherung: 'ÖGK', svnr: '456', dob: '1970-02-02', join_status: 'approved' },
    ],
  }, extra);
}

async function setupPage(page, extraSeed) {
  await installMockSupabase(page, seed(extraSeed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await patientsReady; await renderUebersichtRecall(); });
}

function monthsAgoISO(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

test('a diabetic patient not seen in 8 months (>6 month interval) shows up in the recall list', async ({ page }) => {
  await setupPage(page, {
    patient_visits: [{ id: 'v1', patient_id: 'p1', visit_date: monthsAgoISO(8), visit_type: 'Kontrolle', diagnose: 'Diabetes mellitus Typ 2', created_at: new Date().toISOString() }],
  });
  const html = await page.evaluate(() => document.getElementById('uebersichtRecallRoot').innerHTML);
  expect(html).toContain('Maria Huber');
  expect(html).toContain('Diabetes');
});

test('a diabetic patient seen 2 months ago (within interval) is not in the recall list, and the empty state shows', async ({ page }) => {
  await setupPage(page, {
    patient_visits: [{ id: 'v1', patient_id: 'p1', visit_date: monthsAgoISO(2), visit_type: 'Kontrolle', diagnose: 'Diabetes mellitus Typ 2', created_at: new Date().toISOString() }],
  });
  const html = await page.evaluate(() => document.getElementById('uebersichtRecallRoot').innerHTML);
  expect(html).not.toContain('Maria Huber');
  expect(html).toContain('Keine fälligen Kontrollpatienten');
});

test('a patient with no chronic-condition keyword in their history is never in the list', async ({ page }) => {
  await setupPage(page, {
    patient_visits: [{ id: 'v1', patient_id: 'p1', visit_date: monthsAgoISO(24), visit_type: 'Kontrolle', diagnose: 'Grippaler Infekt', created_at: new Date().toISOString() }],
  });
  const html = await page.evaluate(() => document.getElementById('uebersichtRecallRoot').innerHTML);
  expect(html).toContain('Keine fälligen Kontrollpatienten');
});

test('the list covers the whole practice, not just one patient -- two different overdue patients both show, sorted most-overdue first', async ({ page }) => {
  await setupPage(page, {
    patient_visits: [
      { id: 'v1', patient_id: 'p1', visit_date: monthsAgoISO(7), visit_type: 'Kontrolle', diagnose: 'Diabetes mellitus Typ 2', created_at: new Date().toISOString() },
      { id: 'v2', patient_id: 'p2', visit_date: monthsAgoISO(20), visit_type: 'Kontrolle', diagnose: 'Hypertonie', created_at: new Date().toISOString() },
    ],
  });
  const result = await page.evaluate(() => {
    const root = document.getElementById('uebersichtRecallRoot');
    const names = [...root.querySelectorAll('.uebersicht-msg-row')].map(r => r.textContent);
    return names;
  });
  expect(result.length).toBe(2);
  // Karl (Hypertonie, 20 months since, 6-month interval -> overdue by 14) should rank above
  // Maria (Diabetes, 7 months since, 6-month interval -> overdue by 1).
  expect(result[0]).toContain('Karl Gruber');
  expect(result[1]).toContain('Maria Huber');
});

test('clicking a recall row opens that patient\'s chat', async ({ page }) => {
  await setupPage(page, {
    patient_visits: [{ id: 'v1', patient_id: 'p1', visit_date: monthsAgoISO(8), visit_type: 'Kontrolle', diagnose: 'Diabetes mellitus Typ 2', created_at: new Date().toISOString() }],
  });
  await page.click('#uebersichtRecallRoot .uebersicht-msg-row');
  const result = await page.evaluate(() => ({
    view: document.getElementById('view-patienten').classList.contains('active'),
    chatName: document.getElementById('chatName')?.textContent,
  }));
  expect(result.view).toBe(true);
  expect(result.chatName).toContain('Maria Huber');
});

test('the "🔔 Erinnern" button sends a real reminder chat message without navigating away from Übersicht', async ({ page }) => {
  await setupPage(page, {
    patient_visits: [{ id: 'v1', patient_id: 'p1', visit_date: monthsAgoISO(8), visit_type: 'Kontrolle', diagnose: 'Diabetes mellitus Typ 2', created_at: new Date().toISOString() }],
  });
  await page.click('#uebersichtRecallRoot button');
  const result = await page.evaluate(() => ({
    toastText: document.getElementById('toast').textContent,
    view: document.getElementById('view-uebersicht').classList.contains('active'),
    messages: (findPatientAccountByFullName('Maria Huber').accounts['maria.huber'].messages || []),
  }));
  expect(result.toastText).toContain('gesendet');
  expect(result.view, 'the button click must not also trigger the row\'s own navigate-to-chat handler').toBe(true);
  expect(result.messages.length).toBe(1);
  expect(result.messages[0].dir).toBe('out');
  expect(result.messages[0].text).toContain('Kontrolluntersuchung');
  expect(result.messages[0].text).toContain('Diabetes');
  expect(result.messages[0].text).toContain('8 Monate');
});
