// Real gap found via competitor research (see TODO.md): 20-35% of a typical
// Hausarzt practice's phone calls are prescription-renewal requests.
// requestRezeptRenewal() (patient.html) turns the existing "🔁 Erneut
// anfordern" button on a past Kassenrezept chat bubble into a precise chat
// message (same medications/dosages already shown on the bubble) via the
// exact same real send path sendMsg() already uses -- always reviewed by
// staff before a new Rezept is issued, never auto-issued.
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

function rezeptMessageRow(overrides) {
  return Object.assign({
    dir: 'out', type: 'uw', text: 'Rezept ausgestellt · Ibuprofen 400mg, 1x täglich',
    doc_sub: 'Kassenrezept', doc_id: 'doc1', filename: 'Rezept_Maria_Huber.pdf',
    created_at: new Date().toISOString(),
  }, overrides);
}

async function setup(page, messageRows) {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria.huber' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  await page.evaluate(({ row, msgs }) => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [row], error: null });
      if (name === 'patient_get_messages') return Promise.resolve({ data: msgs, error: null });
      return Promise.resolve({ data: [], error: null });
    };
  }, { row: profileRow(), msgs: messageRows });
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);
}

test('a Kassenrezept bubble shows a "🔁 Erneut anfordern" button', async ({ page }) => {
  await setup(page, [rezeptMessageRow()]);
  const html = await page.evaluate(() => document.getElementById('messages').innerHTML);
  expect(html).toContain('Erneut anfordern');
});

test('clicking it sends a precise renewal request with the same medication text, via the real send path', async ({ page }) => {
  await setup(page, [rezeptMessageRow()]);
  const result = await page.evaluate(async () => {
    let calledWith = null;
    sb.rpc = (name, args) => {
      if (name === 'patient_send_message') { calledWith = args.p_text; return Promise.resolve({ data: true, error: null }); }
      if (name === 'patient_get_messages') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    };
    requestRezeptRenewal('Rezept ausgestellt · Ibuprofen 400mg, 1x täglich');
    await new Promise(r => setTimeout(r, 200));
    return { calledWith, inputCleared: document.getElementById('chatInput').value };
  });
  expect(result.calledWith).toBe('🔁 Bitte dieses Rezept erneut ausstellen: Ibuprofen 400mg, 1x täglich');
  expect(result.inputCleared).toBe('');
});

test('a plain-text message (not a Kassenrezept) never shows the renewal button', async ({ page }) => {
  await setup(page, [{ dir: 'out', type: 'text', text: 'Bitte kommen Sie morgen um 9 Uhr.', created_at: new Date().toISOString() }]);
  const html = await page.evaluate(() => document.getElementById('messages').innerHTML);
  expect(html).not.toContain('Erneut anfordern');
});

test('a Kassenrezept the patient supposedly sent themselves (dir:in, would never happen for real) never shows the renewal button', async ({ page }) => {
  await setup(page, [rezeptMessageRow({ dir: 'in' })]);
  const html = await page.evaluate(() => document.getElementById('messages').innerHTML);
  expect(html).not.toContain('Erneut anfordern');
});
