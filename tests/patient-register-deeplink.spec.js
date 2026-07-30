// Regression test for the split between login.html (staff) and
// patient-login.html (patients): the "Als Patient/in anmelden" button used
// to link the two, but a patient with no per-account QR code (e.g. one who
// heard about the practice and wants to self-register from scratch) had no
// other way to discover patient-login.html except by clicking through the
// staff login page first. This removes that link and instead lets a
// practice share a general, patient-register deep link on its own (a
// poster, business card, website) that jumps straight to the
// self-registration form.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('login.html (staff) no longer offers a link to patient-login.html', async ({ page }) => {
  await installMockSupabase(page, {}, () => {});
  await page.goto('file://' + path.join(__dirname, '..', 'login.html'));
  await page.waitForTimeout(500);
  const hasPatientLink = await page.evaluate(() =>
    !!document.querySelector('a[href*="patient-login.html"], button[onclick*="patient-login.html"]')
  );
  expect(hasPatientLink).toBe(false);
});

test('patient-login.html?patient-register jumps straight to the self-registration screen', async ({ page }) => {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html') + '?patient-register=1');
  await page.waitForTimeout(800);
  const state = await page.evaluate(() => ({
    requestScreenActive: document.getElementById('screen-request').classList.contains('active'),
    loginScreenActive: document.getElementById('screen-login').classList.contains('active'),
    urlCleaned: !window.location.search.includes('patient-register'),
  }));
  expect(state.requestScreenActive).toBe(true);
  expect(state.loginScreenActive).toBe(false);
  expect(state.urlCleaned, 'the query param is scrubbed from the URL, same as the QR-login param').toBe(true);
});

test('patient-login.html without the query param still shows the normal login screen', async ({ page }) => {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
  await page.waitForTimeout(800);
  const requestScreenActive = await page.evaluate(() => document.getElementById('screen-request').classList.contains('active'));
  expect(requestScreenActive).toBe(false);
});

// Regression test for the practice_id-misrouting bug found in a
// launch-readiness review (2026-07-30): every QR code/deep link used to
// point at the exact same bare /patient-register URL, so
// patient_join_requests's own insert trigger (supabase/
// phase19_patient_join_requests_rls.sql) always fell back to "the oldest
// practice in the whole database" for every self-registration, regardless
// of which practice's poster/QR the patient actually scanned. secretary.html
// now embeds the practice's real id in the URL (/patient-register/<id>,
// see vercel.json's matching rewrite to ?practice=<id>); this confirms
// patient-login.html actually captures and forwards it.
async function fillJoinRequestForm(page, username) {
  await page.fill('#reqVorname', 'Max');
  await page.fill('#reqNachname', 'Mustermann');
  await page.fill('#reqAdresse', 'Teststr. 1, 1010 Wien');
  await page.fill('#reqSvnr', '1234010180');
  await page.fill('#reqUsername', username);
  await page.fill('#reqPassword', 'geheim123');
  await page.fill('#reqConfirmPw', 'geheim123');
  await page.check('#reqAgb');
}

test('?practice=<id> deep link is forwarded as practice_id on the join-request insert', async ({ page }) => {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html') + '?patient-register=1&practice=practice-real-uuid-1');
  await page.waitForTimeout(800);
  await fillJoinRequestForm(page, 'maxmustermann1');
  await page.click('#screen-request .btn-main');
  await page.waitForTimeout(500);
  const requests = await page.evaluate(() => window.__store.patient_join_requests);
  expect(requests).toHaveLength(1);
  expect(requests[0].practice_id).toBe('practice-real-uuid-1');
});

test('a join request with no practice param in the link still sends practice_id: null (old-QR-code fallback, unchanged)', async ({ page }) => {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html') + '?patient-register=1');
  await page.waitForTimeout(800);
  await fillJoinRequestForm(page, 'maxmustermann2');
  await page.click('#screen-request .btn-main');
  await page.waitForTimeout(500);
  const requests = await page.evaluate(() => window.__store.patient_join_requests);
  expect(requests).toHaveLength(1);
  expect(requests[0].practice_id).toBe(null);
});
