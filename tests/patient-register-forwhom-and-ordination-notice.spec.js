// Real user feedback (2026-08-11), items 2 and 5b:
// 1. The plain "Neu hier? Anmeldung beantragen" self-registration entry
//    (no QR/deep link, so no practice is known yet at this point -- that's
//    resolved later, on the QR-scan screen this hands off to) used to show
//    a permanently-empty "Ordination —/—" notice box -- pure noise, since
//    it can never have anything real to show for this entry path.
// 2. Self-registration had no way to say the account being created is for
//    a child, not the person filling out the form -- a "Für mich / Für
//    mein Kind" toggle now feeds is_child (supabase/phase65_patient_
//    username_change_and_is_child.sql) on the submitted request.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

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

test('the plain "Neu hier?" entry hides the empty Ordination notice', async ({ page }) => {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
  await page.waitForTimeout(500);
  await page.click('a[onclick*="startFreshRegistration"]');
  await page.waitForTimeout(200);
  const state = await page.evaluate(() => ({
    requestScreenActive: document.getElementById('screen-request').classList.contains('active'),
    noticeDisplay: document.querySelector('#screen-request .notice').style.display,
  }));
  expect(state.requestScreenActive).toBe(true);
  expect(state.noticeDisplay).toBe('none');
});

test('a ?patient-register deep-link entry still shows the Ordination notice', async ({ page }) => {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html') + '?patient-register=1');
  await page.waitForTimeout(800);
  const noticeDisplay = await page.evaluate(() => document.querySelector('#screen-request .notice').style.display);
  expect(noticeDisplay).toBe('block');
});

test('leaving "Für mich" selected (the default) submits is_child: false', async ({ page }) => {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html') + '?patient-register=1');
  await page.waitForTimeout(800);
  await fillJoinRequestForm(page, 'formich.user');
  await page.click('#screen-request .btn-main');
  await page.waitForTimeout(500);
  const requests = await page.evaluate(() => window.__store.patient_join_requests);
  expect(requests).toHaveLength(1);
  expect(requests[0].is_child).toBe(false);
});

test('choosing "Für mein Kind" submits is_child: true', async ({ page }) => {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html') + '?patient-register=1');
  await page.waitForTimeout(800);
  await page.click('#reqForChildBtn');
  await fillJoinRequestForm(page, 'furmeinkind.user');
  await page.click('#screen-request .btn-main');
  await page.waitForTimeout(500);
  const requests = await page.evaluate(() => window.__store.patient_join_requests);
  expect(requests).toHaveLength(1);
  expect(requests[0].is_child).toBe(true);
});

test('the "Für wen?" toggle resets back to "Für mich" every time the request screen is freshly shown', async ({ page }) => {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html') + '?patient-register=1');
  await page.waitForTimeout(800);
  await page.click('#reqForChildBtn');
  await page.click('a[onclick*="backToLoginFromRequest"]');
  await page.waitForTimeout(200);
  await page.click('a[onclick*="startFreshRegistration"]');
  await page.waitForTimeout(200);
  const state = await page.evaluate(() => ({
    selfActive: document.getElementById('reqForSelfBtn').classList.contains('active'),
    childActive: document.getElementById('reqForChildBtn').classList.contains('active'),
  }));
  expect(state.selfActive).toBe(true);
  expect(state.childActive).toBe(false);
});
