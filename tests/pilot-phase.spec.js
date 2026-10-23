// Regression tests for supabase/phase87_pilot_90_day_lock.sql's UI half:
// a pilot practice (is_pilot + pilot_until) is locked at its own
// pilot_until -- not trial_start + 30 days -- and both staff consoles show
// a "Pilotphase endet" notice from 14 days before that date. Real incident
// behind this (2026-09-22): a real pilot practice was locked at day 30 and
// auto-anonymized at day 44 because pilots used the normal 30-day trial.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

const DAY = 24 * 60 * 60 * 1000;
function iso(offsetMs) { return new Date(Date.now() + offsetMs).toISOString(); }

function seed(practiceOverrides) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed', practice_id: 'prac1' }],
    practices: [Object.assign({ id: 'prac1', name: 'Pilot-Ordination', plan: 'enterprise', trial_start: iso(-80 * DAY), is_pilot: true, pilot_until: iso(10 * DAY), payment_method: null }, practiceOverrides)],
  };
}

async function setupDoctor(page, practiceOverrides) {
  await installMockSupabase(page, seed(practiceOverrides), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await practiceSettingsReady; applyTrialStatus(); });
}

async function setupSecretary(page, practiceOverrides) {
  await installMockSupabase(page, seed(practiceOverrides), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ u1: { username: 'u1', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await practiceSettingsReady; applyPracticeSettingsGating(); });
}

function bannerState(page) {
  return page.evaluate(() => {
    const el = document.getElementById('pilotEndBanner');
    return {
      visible: !!el && el.style.display === 'flex',
      text: el ? el.textContent : '',
      lock: document.getElementById('trialLockOverlay') ? document.getElementById('trialLockOverlay').style.display : null,
    };
  });
}

test('getPilotEndNotice(): null outside the 14-day window, days rounded up inside it, ended after pilot_until', async ({ page }) => {
  await setupDoctor(page, { pilot_until: '2027-01-15T09:00:00Z' });
  const r = await page.evaluate(() => {
    const until = new Date('2027-01-15T09:00:00Z').getTime();
    const D = 24 * 60 * 60 * 1000;
    return {
      at15: getPilotEndNotice(until - 15 * D),
      at14: getPilotEndNotice(until - 14 * D),
      atHalfDay: getPilotEndNotice(until - D / 2),
      after: getPilotEndNotice(until + 1000),
    };
  });
  expect(r.at15).toBeNull();
  expect(r.at14.daysLeft).toBe(14);
  expect(r.at14.ended).toBe(false);
  expect(r.atHalfDay.daysLeft).toBe(1);
  expect(r.after.ended).toBe(true);
});

test('doctor.html: a pilot 10 days before pilot_until sees the notice with the end date, and is NOT locked even though trial_start is 80 days ago', async ({ page }) => {
  await setupDoctor(page);
  const s = await bannerState(page);
  expect(s.visible).toBe(true);
  expect(s.text).toContain('Ihre Pilotphase endet am');
  expect(s.text).toContain('in 10 Tagen');
  expect(s.text).toContain('team@smartordi.eu');
  expect(s.lock).toBe('none');
  // The normal 7-day trial reminder must not show for a pilot.
  const trialBanner = await page.evaluate(() => document.getElementById('trialReminderBanner').style.display);
  expect(trialBanner).toBe('none');
});

test('doctor.html: showing the notice records it once via practice_ack_pilot_end_notice', async ({ page }) => {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(300);
  const calls = await page.evaluate(async () => {
    const seen = [];
    sb.rpc = async (name) => { seen.push(name); return { data: null, error: null }; };
    _pilotNoticeAckSent = false;
    await practiceSettingsReady;
    applyTrialStatus();
    applyTrialStatus();
    return seen.filter((n) => n === 'practice_ack_pilot_end_notice').length;
  });
  expect(calls).toBe(1);
});

test('doctor.html: a pilot more than 14 days before pilot_until sees no notice and no lock', async ({ page }) => {
  await setupDoctor(page, { pilot_until: iso(30 * DAY) });
  const s = await bannerState(page);
  expect(s.visible).toBe(false);
  expect(s.lock).toBe('none');
});

test('doctor.html: a pilot past pilot_until without payment is locked with the Pilotphase wording', async ({ page }) => {
  await setupDoctor(page, { pilot_until: iso(-1 * DAY) });
  const s = await bannerState(page);
  expect(s.lock).toBe('flex');
  const title = await page.evaluate(() => document.getElementById('trialLockTitle').textContent);
  expect(title).toBe('Ihre Pilotphase ist beendet');
});

test('doctor.html: a pilot with a payment method on file is never locked and sees no notice', async ({ page }) => {
  await setupDoctor(page, { pilot_until: iso(-1 * DAY), payment_method: 'card' });
  const s = await bannerState(page);
  expect(s.lock).toBe('none');
  expect(s.visible).toBe(false);
});

test('doctor.html: a normal (non-pilot) trial keeps the 30-day lock unchanged', async ({ page }) => {
  await setupDoctor(page, { is_pilot: false, pilot_until: null, trial_start: iso(-31 * DAY) });
  const s = await bannerState(page);
  expect(s.lock).toBe('flex');
  expect(s.visible).toBe(false);
  const title = await page.evaluate(() => document.getElementById('trialLockTitle').textContent);
  expect(title).toBe('Ihre Testphase ist abgelaufen');
});

test('secretary.html: a pilot 10 days before pilot_until sees the notice with a contact link (no plan button)', async ({ page }) => {
  await setupSecretary(page);
  const s = await bannerState(page);
  expect(s.visible).toBe(true);
  expect(s.text).toContain('Ihre Pilotphase endet am');
  const r = await page.evaluate(() => ({
    contact: document.getElementById('pilotEndContact').getAttribute('href'),
    choosePlan: !!document.getElementById('pilotEndChoosePlan'),
  }));
  expect(r.contact).toContain('mailto:team@smartordi.eu');
  expect(r.choosePlan).toBe(false);
});
