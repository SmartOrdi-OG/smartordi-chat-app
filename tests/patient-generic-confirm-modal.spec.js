// Real user feedback (2026-08-13, with a screenshot): patient.html's
// logout confirmation used a native window.confirm() -- positioned by the
// browser itself, not the app, and visibly out of place next to every
// other modal here. Replaced with showConfirmDialog()/#genericConfirmModal,
// the same in-app pattern doctor.html already established for its own
// destructive-action confirmations. Also used for requestOwnDataDeletion()
// (tests/patient-self-deletion.spec.js covers its OK path already -- this
// file covers the modal mechanics themselves, plus both flows' Cancel path,
// which the old native-dialog tests never exercised).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function setup(page) {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria.huber' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') {
        return Promise.resolve({
          data: [{
            id: 'p1', username: 'maria.huber', name: 'Maria', full_name: 'Maria Huber',
            fach: null, dob: '1985-01-01', adresse: 'Addr 1', tel: null, email: null,
            versicherung: 'ÖGK', svnr: 'SVNR1', first_login: false,
          }],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    };
  });
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);
}

test('logout: clicking the topbar button opens the in-app modal, not a native browser dialog', async ({ page }) => {
  await setup(page);
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  await page.click('.topbar-logout');
  await page.waitForSelector('#genericConfirmModal.show');
  const state = await page.evaluate(() => ({
    message: document.getElementById('genericConfirmMessage').textContent,
    okLabel: document.getElementById('genericConfirmOkBtn').textContent,
  }));
  expect(dialogs, 'no native confirm()/alert() dialog should ever appear').toEqual([]);
  expect(state.message.length).toBeGreaterThan(0);
  expect(state.okLabel).toBe('Abmelden');
});

test('logout: clicking Cancel closes the modal and does not log out or navigate', async ({ page }) => {
  await setup(page);
  await page.click('.topbar-logout');
  await page.waitForSelector('#genericConfirmModal.show');
  await page.click('#genericConfirmCancelBtn');
  const state = await page.evaluate(() => ({
    modalOpen: document.getElementById('genericConfirmModal').classList.contains('show'),
    stillLoggedIn: !!sessionStorage.getItem('smartordi_user'),
  }));
  expect(state.modalOpen).toBe(false);
  expect(state.stillLoggedIn, 'cancelling must not have logged the patient out').toBe(true);
  expect(page.url()).toContain('patient.html');
});

test('data deletion: the confirm modal uses a danger (red) OK button, and Cancel never calls the RPC', async ({ page }) => {
  await setup(page);
  const rpcCalls = await page.evaluate(async () => {
    const calls = [];
    sb.rpc = (name) => { calls.push(name); return Promise.resolve({ data: [], error: null }); };
    const p = requestOwnDataDeletion();
    await new Promise(r => setTimeout(r, 50));
    const okBg = getComputedStyle(document.getElementById('genericConfirmOkBtn')).backgroundColor;
    resolveGenericConfirm(false);
    await p;
    return { calls, okBg };
  });
  expect(rpcCalls.calls, 'requestOwnDataDeletion() must never call patient_request_deletion when cancelled').not.toContain('patient_request_deletion');
  // #dc2626 -> rgb(220, 38, 38)
  expect(rpcCalls.okBg).toBe('rgb(220, 38, 38)');
});
