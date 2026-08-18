// Real user feedback (2026-08-11), items 2 and 5b:
// 1. The plain "Neu hier? Anmeldung beantragen" self-registration entry
//    (no QR/deep link, so no practice is known yet at this point -- that's
//    resolved later, on the QR-scan screen this hands off to) used to show
//    a permanently-empty "Ordination —/—" notice box -- pure noise, since
//    it can never have anything real to show for this entry path.
// 2. Self-registration had no way to say the account being created is for
//    a child, not the person filling out the form -- is_child (supabase/
//    phase65_patient_username_change_and_is_child.sql) is stamped on the
//    submitted request based on which account type was chosen.
//
// Reworked 2026-08-18 (real user request): the "Für mich / Für mein Kind"
// toggle that used to live inside the personal-data form was replaced by an
// explicit account-type CHOICE screen (screen-account-type, two cards --
// see chooseAccountType() in patient-login.html) shown BEFORE that form.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function fillJoinRequestForm(page, username) {
  await page.fill('#reqVorname', 'Max');
  await page.fill('#reqNachname', 'Mustermann');
  await page.fill('#reqDob', '1990-01-01');
  await page.fill('#reqTel', '+43 1 2345678');
  await page.fill('#reqAdresse', 'Teststr. 1, 1010 Wien');
  await page.fill('#reqSvnr', '1234010180');
  await page.fill('#reqUsername', username);
  await page.fill('#reqPassword', 'geheim123');
  await page.fill('#reqConfirmPw', 'geheim123');
  await page.check('#reqAgb');
}

function clickAccountType(page, type) {
  return page.click(`button[onclick*="chooseAccountType('${type}')"]`);
}

test('the plain "Neu hier?" entry hides the empty Ordination notice', async ({ page }) => {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
  await page.waitForTimeout(500);
  await page.click('a[onclick*="startFreshRegistration"]');
  await page.waitForTimeout(200);
  await clickAccountType(page, 'adult');
  const state = await page.evaluate(() => ({
    requestScreenActive: document.getElementById('screen-request').classList.contains('active'),
    noticeDisplay: document.getElementById('reqOrdinationNotice').style.display,
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
  await clickAccountType(page, 'adult');
  const noticeDisplay = await page.evaluate(() => document.getElementById('reqOrdinationNotice').style.display);
  expect(noticeDisplay).toBe('block');
});

test('choosing the adult account type submits is_child: false', async ({ page }) => {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html') + '?patient-register=1');
  await page.waitForTimeout(800);
  await clickAccountType(page, 'adult');
  await fillJoinRequestForm(page, 'formich.user');
  await page.click('#screen-request .btn-main');
  await page.waitForTimeout(500);
  const requests = await page.evaluate(() => window.__store.patient_join_requests);
  expect(requests).toHaveLength(1);
  expect(requests[0].is_child).toBe(false);
});

test('choosing the children account type submits is_child: true', async ({ page }) => {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html') + '?patient-register=1');
  await page.waitForTimeout(800);
  await clickAccountType(page, 'child');
  await fillJoinRequestForm(page, 'furmeinkind.user');
  await page.click('#screen-request .btn-main');
  await page.waitForTimeout(500);
  const requests = await page.evaluate(() => window.__store.patient_join_requests);
  expect(requests).toHaveLength(1);
  expect(requests[0].is_child).toBe(true);
});

// The children-account form adapts its own title/subtitle and shows a
// notice explaining that more children can be added later (from "Meine
// Profile", once this first one is approved) -- the adult form shows
// neither.
test('the children-account form shows child-specific title/subtitle and the "add more later" notice; the adult form does not', async ({ page }) => {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html') + '?patient-register=1');
  await page.waitForTimeout(800);
  await clickAccountType(page, 'child');
  const childState = await page.evaluate(() => ({
    title: document.getElementById('reqScreenTitle').textContent,
    noticeDisplay: document.getElementById('reqChildNotice').style.display,
  }));
  expect(childState.title).toBe('Antrag für ein Kinder-Konto');
  expect(childState.noticeDisplay).toBe('block');

  await page.click('#screen-request a[onclick*="backToLoginFromRequest"]');
  await page.click('a[onclick*="startFreshRegistration"]');
  await clickAccountType(page, 'adult');
  const adultState = await page.evaluate(() => ({
    title: document.getElementById('reqScreenTitle').textContent,
    noticeDisplay: document.getElementById('reqChildNotice').style.display,
  }));
  expect(adultState.title).toBe('Anmeldung beantragen');
  expect(adultState.noticeDisplay).toBe('none');
});

// Going "back" to the account-type screen (without a full page reload) and
// picking the OTHER type must not leak the earlier choice -- the last pick
// wins, both in the form's own copy and in what actually gets submitted.
test('picking "child" then going back and picking "adult" instead submits is_child: false, not a stale true', async ({ page }) => {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html') + '?patient-register=1');
  await page.waitForTimeout(800);
  await clickAccountType(page, 'child');
  const childTitle = await page.evaluate(() => document.getElementById('reqScreenTitle').textContent);
  expect(childTitle).toBe('Antrag für ein Kinder-Konto');

  await page.click('a[onclick*="backToAccountTypeFromRequest"]');
  await clickAccountType(page, 'adult');
  const adultState = await page.evaluate(() => ({
    title: document.getElementById('reqScreenTitle').textContent,
    noticeDisplay: document.getElementById('reqChildNotice').style.display,
  }));
  expect(adultState.title).toBe('Anmeldung beantragen');
  expect(adultState.noticeDisplay).toBe('none');

  await fillJoinRequestForm(page, 'freshadult.user');
  await page.click('#screen-request .btn-main');
  await page.waitForTimeout(500);
  const requests = await page.evaluate(() => window.__store.patient_join_requests);
  expect(requests).toHaveLength(1);
  expect(requests[0].is_child).toBe(false);
});
