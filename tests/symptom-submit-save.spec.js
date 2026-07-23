// Regression test for patient.html's submitSymptoms(): a real (token-backed)
// patient submitting their reason-for-visit/symptoms went through
// patientSetSymptoms(), which itself never throws on an RPC error -- it just
// logs and returns false (vendor/patient-portal-data.js). submitSymptoms()
// ignored that return value and always showed the "✓ saved" success toast
// regardless of whether the save actually happened, falsely telling the
// patient their note reached the doctor when it never did.
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
      if (name === 'patient_get_termine') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    };
  }, profileRow());
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);
}

test('a real save shows the success toast and actually calls patientSetSymptoms', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    let calledWith = null;
    sb.rpc = (name, args) => {
      if (name === 'patient_set_symptoms') { calledWith = args; return Promise.resolve({ data: true, error: null }); }
      if (name === 'patient_get_termine') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    };
    openSymptomModal('t1');
    document.getElementById('symptomNote').value = 'Kopfschmerzen seit gestern';
    await submitSymptoms();
    return { toast: document.getElementById('toast')?.textContent || '', calledWith };
  });
  expect(result.toast).toContain('gespeichert');
  expect(result.calledWith.p_termin_id).toBe('t1');
  expect(result.calledWith.p_reason_note).toBe('Kopfschmerzen seit gestern');
});

test('a genuine RPC error (data:false) shows the failure toast, not the false success one', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    sb.rpc = (name) => {
      if (name === 'patient_set_symptoms') return Promise.resolve({ data: null, error: { message: 'simulated RPC error' } });
      if (name === 'patient_get_termine') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    };
    openSymptomModal('t1');
    document.getElementById('symptomNote').value = 'Kopfschmerzen seit gestern';
    await submitSymptoms();
    return { toast: document.getElementById('toast')?.textContent || '' };
  });
  expect(result.toast).not.toContain('✓');
  expect(result.toast).toContain('konnten nicht gespeichert werden');
});

test('a thrown exception from the RPC call also shows the failure toast', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    sb.rpc = (name) => {
      if (name === 'patient_set_symptoms') return Promise.reject(new Error('network down'));
      if (name === 'patient_get_termine') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    };
    openSymptomModal('t1');
    document.getElementById('symptomNote').value = 'Kopfschmerzen seit gestern';
    await submitSymptoms();
    return { toast: document.getElementById('toast')?.textContent || '' };
  });
  expect(result.toast).not.toContain('✓');
  expect(result.toast).toContain('konnten nicht gespeichert werden');
});
