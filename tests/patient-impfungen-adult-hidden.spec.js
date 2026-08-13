// Real user feedback (2026-08-12, after a full walkthrough test): the full
// standard (pediatric) vaccination schedule used to show on EVERY patient's
// "Impfungen" card, adult or not, even with zero real doses ever recorded --
// a wall of "Noch nicht fällig" rows nobody asked for. An adult account now
// only sees this card once staff has actually added a real Impfung record
// for them; a child keeps the full tracked schedule (due/overdue/upcoming),
// which is the whole point for them.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function profileRow(overrides) {
  return Object.assign({
    id: 'p1', username: 'maria.huber', name: 'Maria', full_name: 'Maria Huber',
    fach: null, dob: '1985-01-01', adresse: 'Alte Adresse 1', tel: '0123', email: null,
    versicherung: 'ÖGK', svnr: 'SVNR1', first_login: false, is_child: false,
  }, overrides || {});
}

async function setupRemote(page, profile, impfungenRows) {
  // installMockSupabase's extraInit runs via page.addInitScript(), which
  // stringifies the function -- Node-side closures (like `profile` here)
  // don't survive that. The username is always 'maria.huber' in every
  // profileRow() variant this file uses, so it's safe to hardcode as a
  // literal (same pattern as patient-profiles.spec.js's own setupRemote()).
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria.huber' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(500);
  await page.evaluate(({ row, impfungen }) => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [row], error: null });
      if (name === 'patient_get_impfungen') return Promise.resolve({ data: impfungen, error: null });
      return Promise.resolve({ data: [], error: null });
    };
  }, { row: profile, impfungen: impfungenRows || [] });
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);
}

test('an adult account with zero real Impfung records never shows the vaccination card at all', async ({ page }) => {
  await setupRemote(page, profileRow({ is_child: false }), []);
  const state = await page.evaluate(() => ({
    cardVisible: getComputedStyle(document.getElementById('profilImpfungenCard')).display !== 'none',
  }));
  expect(state.cardVisible).toBe(false);
});

test('an adult account with one real Impfung record shows only that vaccine, not the full default schedule', async ({ page }) => {
  await setupRemote(page, profileRow({ is_child: false }), [
    { id: 'i1', vaccine_key: 'influenza', vaccine_name: 'Influenza', dose_label: 'D1', datum: '2026-01-01', next_due: null, created_at: '2026-01-01' },
  ]);
  const state = await page.evaluate(() => ({
    cardVisible: getComputedStyle(document.getElementById('profilImpfungenCard')).display !== 'none',
    html: document.getElementById('profilImpfungenRows').innerHTML,
    rowCount: document.getElementById('profilImpfungenRows').querySelectorAll('.info-row').length,
  }));
  expect(state.cardVisible).toBe(true);
  expect(state.html).toContain('Influenza');
  // Only the vaccine actually on file -- not the whole standard schedule
  // (6-fach, Rotavirus, MMR, ... all absent since none were ever recorded).
  expect(state.rowCount).toBe(1);
});

test('a child account still shows the full standard schedule even with zero real Impfung records', async ({ page }) => {
  await setupRemote(page, profileRow({ is_child: true, dob: '2020-01-01' }), []);
  const state = await page.evaluate(() => ({
    cardVisible: getComputedStyle(document.getElementById('profilImpfungenCard')).display !== 'none',
    rowCount: document.getElementById('profilImpfungenRows').querySelectorAll('.info-row').length,
  }));
  expect(state.cardVisible, 'a child\'s own tracked schedule must not be hidden the same way an adult\'s empty one is').toBe(true);
  expect(state.rowCount).toBeGreaterThan(1);
});

// Real user feedback (2026-08-13): doctor.html's "Sonstige" free-text
// vaccine option (a flu shot, tetanus booster, travel vaccine -- exactly
// what an adult actually gets, not a pediatric primary-series vaccine) has
// no matching VACCINE_SCHEDULE key -- it's stored with vaccine_key=null.
// The old adult filter (VACCINE_SCHEDULE.filter(v => given.some(i =>
// i.vaccineKey===v.key))) silently dropped it since it can never match any
// schedule entry's key. It must show up like any other recorded vaccine.
test('an adult\'s free-text ("Sonstige") vaccine with no matching schedule key still shows up', async ({ page }) => {
  await setupRemote(page, profileRow({ is_child: false }), [
    { id: 'i1', vaccine_key: null, vaccine_name: 'Gelbfieber-Impfung (Reise)', dose_label: null, datum: '2026-02-10', next_due: null, created_at: '2026-02-10' },
  ]);
  const state = await page.evaluate(() => ({
    cardVisible: getComputedStyle(document.getElementById('profilImpfungenCard')).display !== 'none',
    html: document.getElementById('profilImpfungenRows').innerHTML,
    rowCount: document.getElementById('profilImpfungenRows').querySelectorAll('.info-row').length,
  }));
  expect(state.cardVisible).toBe(true);
  expect(state.html).toContain('Gelbfieber-Impfung (Reise)');
  expect(state.rowCount).toBe(1);
  // Not run through the pediatric due/overdue schedule logic -- just
  // confirms it's on file.
  expect(state.html).not.toContain('Überfällig');
  expect(state.html).not.toContain('Fällig');
});

// Real user feedback (2026-08-13): a single adult flu shot used to get run
// through vaccineStatusFor()'s pediatric 2-dose-series logic (since
// "Influenza" DOES match a VACCINE_SCHEDULE entry by name/key) and came out
// "Überfällig" forever, since an adult's one-off shot never completes a
// child's 2-dose infant series. Adults get a plain given-vaccine log
// instead, regardless of whether the name happens to match a schedule
// entry or not.
test('an adult\'s single dose of a vaccine that DOES match a schedule entry (e.g. Influenza) is shown as given, not tracked as overdue for a 2nd pediatric dose', async ({ page }) => {
  await setupRemote(page, profileRow({ is_child: false, dob: '1985-01-01' }), [
    { id: 'i1', vaccine_key: 'influenza', vaccine_name: 'Influenza', dose_label: 'D1', datum: '2026-01-01', next_due: null, created_at: '2026-01-01' },
  ]);
  const html = await page.evaluate(() => document.getElementById('profilImpfungenRows').innerHTML);
  expect(html).toContain('Influenza');
  expect(html).not.toContain('Überfällig');
  expect(html).toContain('Gegeben');
});

// XSS discipline established elsewhere in the codebase (vaccine names are
// staff-entered free text via "Sonstige") -- must be escaped here too.
test('a free-text vaccine name is HTML-escaped, not injected raw', async ({ page }) => {
  await setupRemote(page, profileRow({ is_child: false }), [
    { id: 'i1', vaccine_key: null, vaccine_name: '<img src=x onerror=alert(1)>', dose_label: null, datum: '2026-02-10', next_due: null, created_at: '2026-02-10' },
  ]);
  const html = await page.evaluate(() => document.getElementById('profilImpfungenRows').innerHTML);
  expect(html).not.toContain('<img src=x onerror=alert(1)>');
  expect(html).toContain('&lt;img');
});
