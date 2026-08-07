// New feature, on request ("لما لدكتور والمريض بوافقو على سياسة الخصوصية
// للبرنامج يجينا اشعار بالايميل بالموافقة كدليل"): register.html's DSGVO/
// AGB checkbox and patient-login.html's own AGB/Datenschutz checkbox
// (join-request flow) previously only ever gated their submit button
// client-side -- neither write was ever persisted anywhere, so there was
// no real evidence trail for either consent. Both flows now call
// record_consent() (supabase/phase59_consent_records.sql) right after
// their own real insert succeeds; a Database Webhook on that table (set up
// once in the Supabase dashboard, not exercised by this mocked-Supabase
// sandbox) then emails the platform owner a copy as the actual evidence.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('register.html records a doctor_registration consent with the real practice id, name, email and policy version', async ({ page }) => {
  await installMockSupabase(page, {});
  await page.goto('file://' + path.join(__dirname, '..', 'register.html'));
  await page.waitForTimeout(1000);

  const result = await page.evaluate(async () => {
    const calls = [];
    const origRpc = sb.rpc.bind(sb);
    sb.rpc = (name, args) => {
      if (name === 'record_consent') { calls.push(args); return Promise.resolve({ data: 'c1', error: null }); }
      return origRpc(name, args);
    };
    document.getElementById('f-vorname').value = 'Sarah';
    document.getElementById('f-nachname').value = 'Ahmed';
    document.getElementById('f-fach').value = document.getElementById('f-fach').options[1]?.value || 'Allgemeinmedizin';
    document.getElementById('f-ordination').value = 'Test Ordination';
    document.getElementById('f-adresse').value = 'Teststraße 1, Linz';
    document.getElementById('f-email').value = 'sarah@example.com';
    document.getElementById('f-tel').value = '+43 660 1234567';
    document.getElementById('f-password').value = 'sicheres-passwort-123';
    document.getElementById('f-password-confirm').value = 'sicheres-passwort-123';
    document.getElementById('cb-dsgvo').checked = true;
    document.getElementById('cb-agb').checked = true;
    await doRegister();
    await new Promise(r => setTimeout(r, 300));
    return { calls, practices: window.__store.practices };
  });

  expect(result.calls).toHaveLength(1);
  expect(result.calls[0].p_consent_type).toBe('doctor_registration');
  expect(result.calls[0].p_practice_id).toBe(result.practices[0].id);
  expect(result.calls[0].p_full_name).toBe('Sarah Ahmed');
  expect(result.calls[0].p_email).toBe('sarah@example.com');
  expect(result.calls[0].p_policy_version).toBeTruthy();
  expect(result.calls[0].p_user_agent).toBeTruthy();
});

test('register.html never records consent if the checkboxes are unchecked (submit is blocked first)', async ({ page }) => {
  await installMockSupabase(page, {});
  await page.goto('file://' + path.join(__dirname, '..', 'register.html'));
  await page.waitForTimeout(1000);

  const result = await page.evaluate(async () => {
    const calls = [];
    sb.rpc = (name, args) => { if (name === 'record_consent') calls.push(args); return Promise.resolve({ data: null, error: null }); };
    document.getElementById('f-vorname').value = 'Sarah';
    document.getElementById('f-nachname').value = 'Ahmed';
    document.getElementById('f-fach').value = document.getElementById('f-fach').options[1]?.value || 'Allgemeinmedizin';
    document.getElementById('f-ordination').value = 'Test Ordination';
    document.getElementById('f-adresse').value = 'Teststraße 1, Linz';
    document.getElementById('f-email').value = 'sarah@example.com';
    document.getElementById('f-tel').value = '+43 660 1234567';
    document.getElementById('f-password').value = 'sicheres-passwort-123';
    document.getElementById('f-password-confirm').value = 'sicheres-passwort-123';
    document.getElementById('cb-dsgvo').checked = false; // never accepted
    document.getElementById('cb-agb').checked = true;
    await doRegister();
    await new Promise(r => setTimeout(r, 300));
    return { calls, practices: window.__store.practices };
  });

  expect(result.practices).toHaveLength(0);
  expect(result.calls).toHaveLength(0);
});

test('patient-login.html records a patient_join_request consent with the real practice id, name and policy version', async ({ page }) => {
  await installMockSupabase(page, {}, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html') + '?patient-register=1&practice=prac1');
  await page.waitForTimeout(1000);

  const result = await page.evaluate(async () => {
    const calls = [];
    const origRpc = sb.rpc.bind(sb);
    sb.rpc = (name, args) => {
      if (name === 'record_consent') { calls.push(args); return Promise.resolve({ data: 'c1', error: null }); }
      return origRpc(name, args);
    };
    joinRequestPracticeId = 'prac1';
    document.getElementById('reqVorname').value = 'Maria';
    document.getElementById('reqNachname').value = 'Huber';
    document.getElementById('reqAdresse').value = 'Teststraße 1, Linz';
    document.getElementById('reqSvnr').value = '1234 010190';
    document.getElementById('reqUsername').value = 'maria.huber';
    document.getElementById('reqPassword').value = 'sicheres-passwort-123';
    document.getElementById('reqConfirmPw').value = 'sicheres-passwort-123';
    document.getElementById('reqAgb').checked = true;
    await submitJoinRequest();
    await new Promise(r => setTimeout(r, 300));
    return { calls, joinRequests: window.__store.patient_join_requests };
  });

  expect(result.joinRequests).toHaveLength(1);
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0].p_consent_type).toBe('patient_join_request');
  expect(result.calls[0].p_practice_id).toBe('prac1');
  expect(result.calls[0].p_full_name).toBe('Maria Huber');
  expect(result.calls[0].p_policy_version).toBeTruthy();
  expect(result.calls[0].p_user_agent).toBeTruthy();
});
