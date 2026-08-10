// Step 4 of the patient-interface work: a Settings area where the patient
// can edit their own address/phone/email -- previously the only way to
// change these was staff editing Stammdaten on the patient's behalf, even
// though patient_get_profile() has always returned them. Deliberately
// scoped to just contact info (supabase/phase63_patient_update_profile.sql):
// name/Geburtsdatum/Versicherung/SV-Nummer stay staff-controlled.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function profileRow() {
  return {
    id: 'p1', username: 'maria.huber', name: 'Maria', full_name: 'Maria Huber',
    fach: null, dob: '1985-01-01', adresse: 'Alte Adresse 1', tel: '+43 1 111', email: 'old@example.at',
    versicherung: 'ÖGK', svnr: 'SVNR1', first_login: false,
  };
}

async function setupRemote(page) {
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

test('opening the edit modal pre-fills the current address/phone/email', async ({ page }) => {
  await setupRemote(page);
  const state = await page.evaluate(() => {
    openEditContactModal();
    return {
      adresse: document.getElementById('editAdresse').value,
      tel: document.getElementById('editTel').value,
      email: document.getElementById('editEmail').value,
    };
  });
  expect(state.adresse).toBe('Alte Adresse 1');
  expect(state.tel).toBe('+43 1 111');
  expect(state.email).toBe('old@example.at');
});

test('a real account save calls patient_update_profile with the edited fields and updates the Profil view', async ({ page }) => {
  await setupRemote(page);
  const result = await page.evaluate(async (row) => {
    let calledWith = null;
    sb.rpc = (name, args) => {
      if (name === 'patient_update_profile') { calledWith = args; return Promise.resolve({ data: true, error: null }); }
      if (name === 'patient_get_profile') return Promise.resolve({ data: [{ ...row, adresse: args?.p_adresse ?? row.adresse, tel: args?.p_tel ?? row.tel, email: args?.p_email ?? row.email }], error: null });
      return Promise.resolve({ data: [], error: null });
    };
    openEditContactModal();
    document.getElementById('editAdresse').value = 'Neue Adresse 5, 4020 Linz';
    document.getElementById('editTel').value = '+43 660 1234567';
    document.getElementById('editEmail').value = 'new@example.at';
    await saveContactEdit();
    return {
      calledWith,
      modalOpen: document.getElementById('editContactModal').classList.contains('show'),
      profilAdresse: document.getElementById('profilAdresse').textContent,
      profilTel: document.getElementById('profilTel').textContent,
      profilEmail: document.getElementById('profilEmail').textContent,
      toast: document.getElementById('toast')?.textContent || '',
    };
  }, profileRow());
  expect(result.calledWith.p_adresse).toBe('Neue Adresse 5, 4020 Linz');
  expect(result.calledWith.p_tel).toBe('+43 660 1234567');
  expect(result.calledWith.p_email).toBe('new@example.at');
  expect(result.modalOpen).toBe(false);
  expect(result.profilAdresse).toBe('Neue Adresse 5, 4020 Linz');
  expect(result.profilTel).toBe('+43 660 1234567');
  expect(result.profilEmail).toBe('new@example.at');
  expect(result.toast).toContain('gespeichert');
});

test('a genuine RPC failure shows an error and does not close the modal or fake success', async ({ page }) => {
  await setupRemote(page);
  const result = await page.evaluate(async () => {
    sb.rpc = (name) => {
      if (name === 'patient_update_profile') return Promise.resolve({ data: null, error: { message: 'simulated RPC error' } });
      return Promise.resolve({ data: [], error: null });
    };
    openEditContactModal();
    document.getElementById('editAdresse').value = 'Sollte nicht gespeichert werden';
    await saveContactEdit();
    return {
      modalOpen: document.getElementById('editContactModal').classList.contains('show'),
      errorVisible: document.getElementById('editContactError').style.display !== 'none',
      profilAdresse: document.getElementById('profilAdresse').textContent,
    };
  });
  expect(result.modalOpen).toBe(true);
  expect(result.errorVisible).toBe(true);
  expect(result.profilAdresse).toBe('Alte Adresse 1');
});

test('an obviously invalid email is rejected client-side before any save attempt', async ({ page }) => {
  await setupRemote(page);
  const result = await page.evaluate(async () => {
    let rpcCalled = false;
    sb.rpc = (name) => {
      if (name === 'patient_update_profile') { rpcCalled = true; return Promise.resolve({ data: true, error: null }); }
      return Promise.resolve({ data: [], error: null });
    };
    openEditContactModal();
    document.getElementById('editEmail').value = 'not-an-email';
    await saveContactEdit();
    return {
      rpcCalled,
      errorVisible: document.getElementById('editContactError').style.display !== 'none',
    };
  });
  expect(result.rpcCalled).toBe(false);
  expect(result.errorVisible).toBe(true);
});

test('a local/demo (non-token) account saves straight to its own localStorage record', async ({ page }) => {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'demo1' }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({
      demo1: { fullName: 'Demo Patient', name: 'Demo', role: 'patient', adresse: 'Demo Str 1' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  const result = await page.evaluate(async () => {
    openEditContactModal();
    document.getElementById('editAdresse').value = 'Neue Demo Str 9';
    document.getElementById('editTel').value = '0043 1 999';
    document.getElementById('editEmail').value = 'demo@example.at';
    await saveContactEdit();
    return {
      stored: JSON.parse(localStorage.getItem('smartordi_patient_accounts')).demo1,
      profilAdresse: document.getElementById('profilAdresse').textContent,
    };
  });
  expect(result.stored.adresse).toBe('Neue Demo Str 9');
  expect(result.stored.tel).toBe('0043 1 999');
  expect(result.stored.email).toBe('demo@example.at');
  expect(result.profilAdresse).toBe('Neue Demo Str 9');
});
