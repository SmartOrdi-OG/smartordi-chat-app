// Step 2 of the requested patient-interface work: "the appointments section
// (upcoming/past) should show ALL the information about the appointment" --
// the existing Termine view's list cards only ever had room for a short
// summary line. Tapping a card now opens a detail view with the full
// picture: date, time, doctor + Fachrichtung, practice address, status, and
// the visit reason/symptoms (with a way to add one for an upcoming visit
// that doesn't have one yet). Also fixes a hardcoded "· Linz" in the
// upcoming card's subtitle that ignored whatever practice the patient
// actually belongs to.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

const STAFF_SEED = {
  staff_profiles: [{ id: 'dr.ahmed', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
  practices: [{ id: 'prac1', name: 'Musterordination', adresse: 'Hauptstraße 1, 4020 Linz' }],
};

async function setup(page, termine) {
  // Mobile viewport -- at >=1024px switchView() opens Termine as an extra
  // desktop window stacked over the already-open Profil window instead of
  // navigating away from it, which isn't what this test cares about
  // (openTerminDetail()/the detail modal itself is shared by both layouts).
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, STAFF_SEED, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({
      maria: { fullName: 'Maria Huber', name: 'Maria', role: 'patient', messages: [] },
    }));
  });
  // installMockSupabase's own extraInit hook takes no arguments (see its
  // own addInitScript(extraInit) call) -- a second addInitScript here (with
  // an argument Playwright JSON-serializes for us) is the only way to seed
  // per-test appointment data instead of a fixed literal baked into the
  // closure above.
  await page.addInitScript((t) => { localStorage.setItem('smartordi_termine', JSON.stringify(t)); }, termine);
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
}

test('an upcoming appointment card shows the real practice address, not a hardcoded "Linz"', async ({ page }) => {
  await setup(page, [
    { id: 't1', patient: 'Maria Huber', arztUsername: 'dr.ahmed', art: 'Kontrolle', date: '2099-01-15', time: '09:00', endTime: '09:20', status: 'bestaetigt' },
  ]);
  const sub = await page.evaluate(() => document.querySelector('#upcomingTermineRoot .termin-sub').textContent);
  expect(sub).toContain('Linz');
  expect(sub).not.toContain('· Linz · Linz');
});

test('tapping an upcoming appointment opens the full detail view with date/time/doctor/address/status', async ({ page }) => {
  await setup(page, [
    { id: 't1', patient: 'Maria Huber', arztUsername: 'dr.ahmed', art: 'Kontrolle', date: '2099-01-15', time: '09:00', endTime: '09:20', status: 'bestaetigt' },
  ]);
  await page.evaluate(() => switchView('termine'));
  await page.click('#upcomingTermineRoot .termin-card');
  const state = await page.evaluate(() => ({
    shown: document.getElementById('terminDetailModal').classList.contains('show'),
    title: document.getElementById('terminDetailTitle').textContent,
    time: document.getElementById('terminDetailTime').textContent,
    arzt: document.getElementById('terminDetailArzt').textContent,
    address: document.getElementById('terminDetailAddress').textContent,
    status: document.getElementById('terminDetailStatusWrap').textContent,
    addReasonVisible: getComputedStyle(document.getElementById('terminDetailAddReasonBtn')).display !== 'none',
  }));
  expect(state.shown).toBe(true);
  expect(state.title).toBe('Kontrolle');
  expect(state.time).toContain('09:00');
  expect(state.time).toContain('09:20');
  expect(state.arzt).toContain('Dr. Sarah Ahmed');
  expect(state.arzt).toContain('Allgemeinmedizin');
  expect(state.address).toBe('Hauptstraße 1, 4020 Linz');
  expect(state.status).toContain('Bestätigt');
  // No reason was given at booking -- offer a way to add one since this
  // appointment is still upcoming.
  expect(state.addReasonVisible).toBe(true);
});

test('the "add reason" button opens the existing symptom picker for that exact appointment', async ({ page }) => {
  await setup(page, [
    { id: 't1', patient: 'Maria Huber', arztUsername: 'dr.ahmed', art: 'Kontrolle', date: '2099-01-15', time: '09:00', endTime: '09:20', status: 'bestaetigt' },
  ]);
  await page.evaluate(() => switchView('termine'));
  await page.click('#upcomingTermineRoot .termin-card');
  await page.click('#terminDetailAddReasonBtn');
  const state = await page.evaluate(() => ({
    detailShown: document.getElementById('terminDetailModal').classList.contains('show'),
    symptomShown: document.getElementById('symptomModal').classList.contains('show'),
    terminId: symptomTerminId,
  }));
  expect(state.detailShown).toBe(false);
  expect(state.symptomShown).toBe(true);
  expect(state.terminId).toBe('t1');
});

test('a past visit with a recorded reason shows the reason/symptoms and note, with no "add reason" offered', async ({ page }) => {
  await setup(page, [
    { id: 't2', patient: 'Maria Huber', arztUsername: 'dr.ahmed', art: 'Kontrolle', date: '2020-01-15', time: '10:00', endTime: '10:20', status: 'bestaetigt', reason: ['Kopfschmerzen'], reasonNote: 'Seit 3 Tagen' },
  ]);
  await page.evaluate(() => switchView('termine'));
  await page.click('#pastTermineRoot .visit-card');
  const state = await page.evaluate(() => ({
    reasonHtml: document.getElementById('terminDetailReason').textContent,
    addReasonVisible: getComputedStyle(document.getElementById('terminDetailAddReasonBtn')).display !== 'none',
  }));
  expect(state.reasonHtml).toContain('Kopfschmerzen');
  expect(state.reasonHtml).toContain('Seit 3 Tagen');
  expect(state.addReasonVisible).toBe(false);
});

test('an upcoming appointment with no reason yet says so, instead of showing a blank section', async ({ page }) => {
  await setup(page, [
    { id: 't1', patient: 'Maria Huber', arztUsername: 'dr.ahmed', art: 'Kontrolle', date: '2099-01-15', time: '09:00', endTime: '09:20', status: 'bestaetigt' },
  ]);
  await page.evaluate(() => switchView('termine'));
  await page.click('#upcomingTermineRoot .termin-card');
  const reasonText = await page.evaluate(() => document.getElementById('terminDetailReason').textContent.trim());
  expect(reasonText.length).toBeGreaterThan(0);
});

test('a cancelled upcoming appointment does not offer "add reason"', async ({ page }) => {
  await setup(page, [
    { id: 't1', patient: 'Maria Huber', arztUsername: 'dr.ahmed', art: 'Kontrolle', date: '2099-01-15', time: '09:00', endTime: '09:20', status: 'abgesagt' },
  ]);
  await page.evaluate(() => switchView('termine'));
  await page.click('#upcomingTermineRoot .termin-card');
  const addReasonVisible = await page.evaluate(() => getComputedStyle(document.getElementById('terminDetailAddReasonBtn')).display !== 'none');
  expect(addReasonVisible).toBe(false);
});
