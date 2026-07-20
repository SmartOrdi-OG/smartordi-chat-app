// Regression test for supabase/phase8_anamnese.sql: a patient with no
// server-side Anamnese on record yet must be shown the mandatory
// first-login Anamnese screen, and submitting it must actually persist
// via the patient_set_anamnese RPC (not just move on client-side).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('a first-time real patient sees the Anamnese screen and submitting it saves server-side', async ({ page }) => {
  await installMockSupabase(page, {
    practice_settings: [{ id: true }],
    patients: [{
      id: 'p1', username: 'fatima', full_name: 'Fatima Mohammed', name: 'Fatima',
      fach: 'Allgemeinmedizin', join_status: 'approved', first_login: false, anamnese: null,
      versicherung: 'ÖGK', svnr: '1234567890', dob: '1990-05-12',
    }],
  }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  page.on('dialog', d => d.dismiss());
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    window.__rpcCalls = [];
    sb.rpc = (name, args) => {
      window.__rpcCalls.push(name);
      const p = window.__store.patients.find(x => x.id === 'p1');
      if (name === 'patient_login') {
        return Promise.resolve({ data: [{ token: 'tok-p1', full_name: p.full_name, name: p.name, first_login: p.first_login, join_status: p.join_status, join_note: null, anamnese: p.anamnese }], error: null });
      }
      if (name === 'patient_set_anamnese') {
        p.anamnese = args.p_data;
        return Promise.resolve({ data: true, error: null });
      }
      if (name === 'check_join_request_status') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
  });

  await page.fill('#username', 'fatima');
  await page.fill('#password', 'demo123');
  await page.click('#loginBtn');
  await page.waitForTimeout(1000);

  const anamneseScreenActive = await page.evaluate(() => document.getElementById('screen-anamnese')?.classList.contains('active'));
  expect(anamneseScreenActive, 'server anamnese=null must route to the mandatory Anamnese screen').toBe(true);

  const result = await page.evaluate(async () => {
    const cb = document.querySelector('[data-key="an.common.allergie.penizillin"]');
    if (cb) cb.checked = true;
    await submitAnamnese();
    return {
      rpcCalls: window.__rpcCalls,
      serverAnamnese: window.__store.patients.find(p => p.id === 'p1').anamnese,
    };
  });

  expect(result.rpcCalls).toContain('patient_set_anamnese');
  expect(result.serverAnamnese, 'the answers must actually be persisted server-side, not just kept client-side').toBeTruthy();
});
