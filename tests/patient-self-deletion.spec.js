// Regression test for supabase/phase20_patient_self_deletion.sql: a real
// (Supabase-backed) patient can request their own erasure directly from
// patient.html's Profil view, going through the exact same retention-
// reconciliation logic (10-year § 51 ÄrzteG) as the staff-facing button
// added earlier in secretary.html.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function profileRow() {
  return {
    id: 'p1', username: 'maria.huber', name: 'Maria', full_name: 'Maria Huber',
    fach: null, dob: '1985-01-01', adresse: 'Addr 1', tel: '+43 1', email: 'm@h.at',
    versicherung: 'ÖGK', svnr: 'SVNR1', first_login: false,
  };
}

async function setup(page) {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria.huber' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  await page.evaluate((row) => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [row], error: null });
      return Promise.resolve({ data: [], error: null });
    };
  }, profileRow());
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);
}

test('shows the deletion card for a real account and requests immediate anonymization', async ({ page }) => {
  await setup(page);
  const before = await page.evaluate(() => document.getElementById('profilDeletionCard').style.display);
  expect(before, 'a real (token-backed) account must see the deletion option').toBe('block');

  const result = await page.evaluate(async () => {
    sb.rpc = (name) => name === 'patient_request_deletion'
      ? Promise.resolve({ data: [{ anonymized_immediately: true, effective_or_scheduled_date: '2026-07-19' }], error: null })
      : Promise.resolve({ data: [], error: null });
    window.confirm = () => true;
    await requestOwnDataDeletion();
    await new Promise(r => setTimeout(r, 50));
    return { resultText: document.getElementById('profilDeletionResult').textContent };
  });
  expect(result.resultText).toContain('anonymisiert');
});

test('a still-running retention period is reported with the scheduled date and legal reason', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    window.confirm = () => true;
    sb.rpc = (name) => name === 'patient_request_deletion'
      ? Promise.resolve({ data: [{ anonymized_immediately: false, effective_or_scheduled_date: '2031-03-05' }], error: null })
      : Promise.resolve({ data: [], error: null });
    await requestOwnDataDeletion();
    await new Promise(r => setTimeout(r, 50));
    return { resultText: document.getElementById('profilDeletionResult').textContent };
  });
  expect(result.resultText).toContain('2031');
  expect(result.resultText).toContain('§ 51 ÄrzteG');
});

test('a local-only (demo/guardian) account never sees the deletion option', async ({ page }) => {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'demo.kid' }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({
      'demo.kid': { name: 'Kid', fullName: 'Demo Kid', role: 'patient' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);
  const display = await page.evaluate(() => document.getElementById('profilDeletionCard').style.display);
  expect(display, 'an account with no real Supabase identity has nothing to delete server-side').toBe('none');
});
