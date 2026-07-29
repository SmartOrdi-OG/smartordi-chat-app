// Regression test for supabase/phase45_patient_staff_roster.sql -- a live
// production bug found via a user report: patient.html's "Termin buchen"
// Arzt dropdown (and the Profil tab's "Behandelnde Ärzte/Ärztinnen" row)
// were silently EMPTY for every real (Supabase-backed) patient/guardian
// session. Root cause: vendor/staff-accounts.js's refreshStaffRoster()
// does a direct sb.from('staff_profiles').select('*'), which relies on
// RLS -- correct for a staff session, but a patient/guardian's own
// auth.uid() has no row in staff_profiles at all, so current_practice_id()
// (which reads FROM staff_profiles) resolves to null for them and the
// table's own RLS policy never matches anything. Invisible to this whole
// suite before now because the mock Supabase used in tests doesn't
// simulate RLS at all -- sb.from('staff_profiles').select('*') always
// just returns every seeded row regardless of "session".
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function setupPatientPage(page, rpcOverrides) {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  await page.evaluate((overrides) => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [{ id: 'p1', username: 'maria', name: 'Maria', full_name: 'Maria Huber', dob: '1985-01-01', first_login: false }], error: null });
      if (overrides[name] !== undefined) return Promise.resolve(overrides[name]);
      return Promise.resolve({ data: [], error: null });
    };
  }, rpcOverrides || {});
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);
}

test('a real patient session populates the Arzt dropdown from patient_get_staff_roster(), not an empty list', async ({ page }) => {
  await setupPatientPage(page, {
    patient_get_staff_roster: {
      data: [
        { id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin' },
        { id: 'u2', vorname: 'Jonas', nachname: 'Berger', full_name: 'Dr. Jonas Berger', role: 'arzt', fach: 'Kardiologie' },
        { id: 'u3', vorname: 'Test', nachname: 'Sek', full_name: 'Test Sek', role: 'sekretaerin', fach: null },
      ],
      error: null,
    },
  });

  const options = await page.evaluate(() => [...document.getElementById('terminArzt').options].map(o => o.value));
  expect(options, 'both doctors must be offered, the secretary must not be').toEqual(['u1', 'u2']);
});

test('renderProfilArztRows() shows the real doctor names, not an empty section', async ({ page }) => {
  await setupPatientPage(page, {
    patient_get_staff_roster: {
      data: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin' }],
      error: null,
    },
  });
  const text = await page.evaluate(() => document.getElementById('profilArztRows').textContent);
  expect(text).toContain('Dr. Sarah Ahmed');
  expect(text).toContain('Allgemeinmedizin');
});

test('a failed patient_get_staff_roster() call leaves the dropdown empty instead of crashing the page', async ({ page }) => {
  await setupPatientPage(page, {
    patient_get_staff_roster: { data: null, error: { message: 'simulated db error' } },
  });
  const options = await page.evaluate(() => [...document.getElementById('terminArzt').options]);
  expect(options).toHaveLength(0);
  const bookableViaUi = await page.evaluate(() => document.getElementById('termineSub') !== null);
  expect(bookableViaUi, 'the page must still render, not crash, on a roster fetch failure').toBe(true);
});
