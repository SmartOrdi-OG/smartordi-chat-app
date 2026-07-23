// Regression test for patient.html's sendMsg(): a real (token-backed)
// patient's chat message is rendered optimistically into the message list
// (with a "✓✓" delivered-looking mark) before the real Supabase send is
// confirmed. patientSendMessage() does throw on an RPC error, but the
// catch block only logged it to the console -- the message still stayed
// visible in the UI as if delivered, with zero indication to the patient
// that it never actually reached their practice.
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
      if (name === 'patient_get_messages') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    };
  }, profileRow());
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);
}

test('a real send shows no failure toast and actually calls patientSendMessage', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    let calledWith = null;
    sb.rpc = (name, args) => {
      if (name === 'patient_send_message') { calledWith = args.p_text; return Promise.resolve({ data: true, error: null }); }
      if (name === 'patient_get_messages') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    };
    document.getElementById('chatInput').value = 'Ich habe eine Frage zu meinem Rezept.';
    await sendMsg();
    return { toast: document.getElementById('toast')?.textContent || '', calledWith };
  });
  expect(result.toast).not.toContain('konnte nicht gesendet');
  expect(result.calledWith).toBe('Ich habe eine Frage zu meinem Rezept.');
});

test('a genuine send failure shows a failure toast instead of silently pretending it was delivered', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    sb.rpc = (name) => {
      if (name === 'patient_send_message') return Promise.resolve({ data: null, error: { message: 'simulated RPC error' } });
      if (name === 'patient_get_messages') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    };
    document.getElementById('chatInput').value = 'Ich habe eine Frage zu meinem Rezept.';
    await sendMsg();
    return {
      toast: document.getElementById('toast')?.textContent || '',
      messageRenderedLocally: document.getElementById('messages').textContent.includes('Ich habe eine Frage'),
    };
  });
  expect(result.toast).toContain('konnte nicht gesendet werden');
  // The optimistic bubble is still shown locally (by design, same as the
  // rest of the app's optimistic-UI pattern) -- what matters is that the
  // patient is now told the send failed, instead of it looking silently ok.
  expect(result.messageRenderedLocally).toBe(true);
});
