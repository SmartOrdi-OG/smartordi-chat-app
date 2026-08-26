// Real gap found via competitor research (see TODO.md): a big share of a
// typical Hausarzt practice's phone calls are requests to re-issue
// something the patient already got before -- not just prescriptions
// (20-35% of calls), just as often a repeat Krankenstandsbestätigung/
// Pflegefreistellung/Überweisung. isRenewableDocument()/
// requestDocumentRenewal() (patient.html) recognize any of the four from
// their own fixed chat-message text pattern and turn the existing "🔁
// Erneut anfordern" button into a precise chat message via the exact same
// real send path sendMsg() already uses -- always reviewed by staff before
// anything new is actually issued, never auto-issued.
//
// Started out Rezept-only (tests/patient-rezept-renewal-request.spec.js,
// now superseded/removed by this file) -- extended to the other three
// document types since they share the identical chat-message shape.
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

const CASES = [
  {
    label: 'Rezept', sub: 'Kassenrezept',
    originalText: 'Rezept ausgestellt · Ibuprofen 400mg, 1x täglich',
    expectedRequest: '🔁 Bitte dieses Rezept erneut ausstellen: Ibuprofen 400mg, 1x täglich',
  },
  {
    label: 'Überweisung', sub: 'Kardiologie · Dringend',
    originalText: 'Überweisung → Dr. Novak (Kardiologie) · Dringend',
    expectedRequest: '🔁 Bitte diese Überweisung erneut ausstellen: Dr. Novak (Kardiologie) · Dringend',
  },
  {
    label: 'Pflegefreistellung', sub: 'Pflegefreistellung',
    originalText: 'Bestätigung: Pflegefreistellung ausgestellt',
    expectedRequest: '🔁 Bitte erneut eine Pflegefreistellung-Bestätigung ausstellen.',
  },
  {
    label: 'Krankenstandsbestätigung', sub: 'Krankenstandsbestätigung',
    originalText: 'Arbeitsunfähigkeitsmeldung ausgestellt',
    expectedRequest: '🔁 Bitte erneut eine Arbeitsunfähigkeitsmeldung (Krankenstandsbestätigung) ausstellen.',
  },
];

for (const c of CASES) {
  test(`a ${c.label} bubble shows the renewal button, and clicking it sends the exact expected request`, async ({ page }) => {
    await setup(page, [{ dir: 'out', type: 'uw', text: c.originalText, doc_sub: c.sub, doc_id: 'doc1', filename: 'Dok.pdf', created_at: new Date().toISOString() }]);
    const html = await page.evaluate(() => document.getElementById('messages').innerHTML);
    expect(html, `${c.label}: button should show`).toContain('Erneut anfordern');

    const result = await page.evaluate(async (originalText) => {
      let calledWith = null;
      sb.rpc = (name, args) => {
        if (name === 'patient_send_message') { calledWith = args.p_text; return Promise.resolve({ data: true, error: null }); }
        if (name === 'patient_get_messages') return Promise.resolve({ data: [], error: null });
        return Promise.resolve({ data: [], error: null });
      };
      requestDocumentRenewal(originalText);
      await new Promise(r => setTimeout(r, 200));
      return { calledWith, inputCleared: document.getElementById('chatInput').value };
    }, c.originalText);
    expect(result.calledWith, `${c.label}: request text`).toBe(c.expectedRequest);
    expect(result.inputCleared).toBe('');
  });
}

test('a plain-text message never shows the renewal button', async ({ page }) => {
  await setup(page, [{ dir: 'out', type: 'text', text: 'Bitte kommen Sie morgen um 9 Uhr.', created_at: new Date().toISOString() }]);
  const html = await page.evaluate(() => document.getElementById('messages').innerHTML);
  expect(html).not.toContain('Erneut anfordern');
});

test('a document message the patient supposedly sent themselves (dir:in, would never happen for real) never shows the renewal button', async ({ page }) => {
  await setup(page, [{ dir: 'in', type: 'uw', text: 'Rezept ausgestellt · Ibuprofen 400mg', doc_sub: 'Kassenrezept', doc_id: 'doc1', filename: 'Rezept.pdf', created_at: new Date().toISOString() }]);
  const html = await page.evaluate(() => document.getElementById('messages').innerHTML);
  expect(html).not.toContain('Erneut anfordern');
});

test('an unrecognized "uw" message text is a no-op if requestDocumentRenewal is somehow called on it directly', async ({ page }) => {
  await setup(page, []);
  const result = await page.evaluate(async () => {
    let called = false;
    sb.rpc = (name) => { if (name === 'patient_send_message') called = true; return Promise.resolve({ data: true, error: null }); };
    requestDocumentRenewal('Irgendein anderer Dokumenttext');
    await new Promise(r => setTimeout(r, 100));
    return { called, inputValue: document.getElementById('chatInput').value };
  });
  expect(result.called).toBe(false);
  expect(result.inputValue).toBe('');
});
