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
