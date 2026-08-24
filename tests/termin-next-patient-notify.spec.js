// Real gap found via competitor research (see TODO.md): standalone "digital
// waiting room" apps (Dr.wait, Quickticket) exist specifically so a patient
// can wait away from the practice instead of physically in the Wartezimmer.
// SmartOrdi already has a patient chat channel, so notifyNextWaitingPatient()
// (vendor/patient-data.js) bundles this in for free -- fired the moment
// startTerminVisit() marks a visit as started, so whichever of this doctor's
// remaining today's appointments is earliest by time (and still fully
// untouched) gets a "you're up next" chat message, giving them real travel
// time instead of pinging them only once the room is already free.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed({ practiceOverrides, terminOverrides } = {}) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [Object.assign({ id: 'prac1' }, practiceOverrides)],
    patients: [
      { id: 'p1', username: 'karl.gruber', full_name: 'Karl Gruber', name: 'Karl', versicherung: 'ÖGK', svnr: '456', dob: '1970-02-02', join_status: 'approved' },
      { id: 'p2', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'BVAEB', svnr: '789', dob: '1985-05-05', join_status: 'approved' },
      { id: 'p3', username: 'peter.klein', full_name: 'Peter Klein', name: 'Peter', versicherung: 'ÖGK', svnr: '111', dob: '1990-01-01', join_status: 'approved' },
    ],
    termine: [
      { id: 't1', patient_id: 'p1', patient_name: 'Karl Gruber', art: 'Kontrolle', date: '2026-08-05', time: '13:00', end_time: '13:20', status: 'neu', arzt_id: 'u1', versicherung: 'ÖGK', svnr: '456', dob: '1970-02-02', created_at: new Date().toISOString() },
      { id: 't2', patient_id: 'p2', patient_name: 'Maria Huber', art: 'Kontrolle', date: '2026-08-05', time: '13:20', end_time: '13:40', status: 'neu', arzt_id: 'u1', versicherung: 'BVAEB', svnr: '789', dob: '1985-05-05', created_at: new Date().toISOString() },
      Object.assign({ id: 't3', patient_id: 'p3', patient_name: 'Peter Klein', art: 'Kontrolle', date: '2026-08-05', time: '13:40', end_time: '14:00', status: 'neu', arzt_id: 'u1', versicherung: 'ÖGK', svnr: '111', dob: '1990-01-01', created_at: new Date().toISOString() }, terminOverrides),
    ],
  };
}

async function setupPage(page, opts) {
  await installMockSupabase(page, seed(opts), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, termineReady]); });
}

test('starting the first appointment notifies the next (earliest-by-time, untouched) patient, not any other', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    await startTerminVisit('t1');
    return {
      t2NotifiedAt: loadTermine().find(t => t.id === 't2').nextNotifiedAt,
      t3NotifiedAt: loadTermine().find(t => t.id === 't3').nextNotifiedAt,
      messages: window.__store.patient_messages.map(m => ({ patientId: m.patient_id, text: m.text, dir: m.dir })),
    };
  });
  expect(result.t2NotifiedAt, 'the earliest still-untouched appointment (t2) is marked notified').toBeTruthy();
  expect(result.t3NotifiedAt, 'a later appointment (t3) is left untouched').toBeFalsy();
  expect(result.messages.length).toBe(1);
  expect(result.messages[0].patientId).toBe('p2');
  expect(result.messages[0].dir).toBe('out');
  expect(result.messages[0].text).toContain('Praxis kommen');
});

test('starting a visit does not re-notify a patient already marked next_notified_at', async ({ page }) => {
  await setupPage(page, { terminOverrides: {} });
  await page.evaluate(async () => {
    // t2 already got the "you're up next" ping earlier today (e.g. from a
    // previous Start click) -- notifyNextWaitingPatient() must skip straight
    // past it to t3 instead of re-sending.
    const t2 = window.__store.termine.find(t => t.id === 't2');
    t2.next_notified_at = new Date().toISOString();
    await refreshTermine();
    await startTerminVisit('t1');
  });
  const result = await page.evaluate(() => ({
    t3NotifiedAt: loadTermine().find(t => t.id === 't3').nextNotifiedAt,
    messages: window.__store.patient_messages.map(m => m.patient_id),
  }));
  expect(result.t3NotifiedAt, 'skips past the already-notified t2 straight to t3').toBeTruthy();
  expect(result.messages).toEqual(['p3']);
});

test('no notification is sent when Praxis-Chat is disabled for the practice', async ({ page }) => {
  await setupPage(page, { practiceOverrides: { chat_enabled: false } });
  const result = await page.evaluate(async () => {
    await startTerminVisit('t1');
    return {
      t2NotifiedAt: loadTermine().find(t => t.id === 't2').nextNotifiedAt,
      messageCount: window.__store.patient_messages.length,
    };
  });
  expect(result.t2NotifiedAt).toBeFalsy();
  expect(result.messageCount).toBe(0);
});

test('a cancelled next appointment is skipped in favor of the one after it', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(() => {
    window.__store.termine.find(t => t.id === 't2').status = 'abgesagt';
  });
  const result = await page.evaluate(async () => {
    await refreshTermine();
    await startTerminVisit('t1');
    return {
      t3NotifiedAt: loadTermine().find(t => t.id === 't3').nextNotifiedAt,
      messages: window.__store.patient_messages.map(m => m.patient_id),
    };
  });
  expect(result.t3NotifiedAt, 'a cancelled appointment (t2) is never notified, t3 gets it instead').toBeTruthy();
  expect(result.messages).toEqual(['p3']);
});

test('completing (not starting) a visit sends no notification -- only starting a visit does', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    await completeTerminVisit('t1');
    return { messageCount: window.__store.patient_messages.length };
  });
  expect(result.messageCount).toBe(0);
});
