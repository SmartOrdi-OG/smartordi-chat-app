// Real user report: the Chat nav badge always showed a hardcoded "2" (baked
// into patient.html's static markup) whenever the account had ANY messages
// at all, read or not -- reloading the page (or logging back in later)
// always reset it right back to that same meaningless number, even with
// zero genuinely new messages since the patient last looked. Fixed by
// tracking a real per-device "last viewed" marker (same convention as
// secretary.html's own unread tracking) and computing an actual unread
// count from dir:'out' (staff-written) messages newer than it.
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
function messageRows() {
  return [
    { id: 'm1', dir: 'in', type: 'text', text: 'Hallo, ich habe eine Frage.', created_at: '2026-08-01T09:00:00Z' },
    { id: 'm2', dir: 'out', type: 'text', text: 'Guten Tag, wie kann ich helfen?', created_at: '2026-08-01T09:05:00Z' },
    { id: 'm3', dir: 'out', type: 'text', text: 'Bitte kommen Sie morgen vorbei.', created_at: '2026-08-01T09:06:00Z' },
    { id: 'm4', dir: 'out', type: 'text', text: 'Denken Sie an Ihre Unterlagen.', created_at: '2026-08-01T09:07:00Z' },
  ];
}

async function setup(page, messages) {
  // Mobile viewport -- .bottom-nav (which #nav-chat .nav-badge lives in) is
  // forced display:none!important at >=1024px, where the desktop icon
  // sidebar (#navTabChatBadge) takes over instead. The default Playwright
  // viewport is desktop-width, which would make every visibility assertion
  // here pass for the wrong reason regardless of updateChatBadge()'s logic.
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria.huber' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(500);
  await page.evaluate((args) => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [args.row], error: null });
      if (name === 'patient_get_messages') return Promise.resolve({ data: args.messages, error: null });
      return Promise.resolve({ data: [], error: null });
    };
  }, { row: profileRow(), messages });
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);
}

test('a patient with real staff messages sees the actual unread count, not a hardcoded "2"', async ({ page }) => {
  await setup(page, messageRows()); // 3 dir:'out' messages
  const badgeText = await page.locator('#nav-chat .nav-badge').textContent();
  expect(badgeText.trim()).toBe('3');
});

test('opening the chat clears the badge, and it stays cleared across a later reload/re-init with the same messages', async ({ page }) => {
  await setup(page, messageRows());
  await page.evaluate(() => switchView('chat'));
  await expect(page.locator('#nav-chat .nav-badge')).toBeHidden();

  // Simulate the account being re-initialized later (e.g. a page reload) --
  // same messages, no new ones since the patient looked. The old bug reset
  // the badge straight back to the static "2" here; the fix should keep it
  // cleared since nothing genuinely new has arrived.
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);
  await expect(page.locator('#nav-chat .nav-badge')).toBeHidden();
});

test('a genuinely new staff message after the last-viewed marker does show up in the badge', async ({ page }) => {
  await setup(page, messageRows());
  await page.evaluate(() => switchView('chat'));
  await expect(page.locator('#nav-chat .nav-badge')).toBeHidden();

  // Must be genuinely after the real wall-clock "last viewed" marker
  // switchView('chat') just recorded above -- a hardcoded past date would
  // never count as unread regardless of the fix being correct or not.
  const withNewMessage = messageRows().concat([
    { id: 'm5', dir: 'out', type: 'text', text: 'Ihr Befund ist da.', created_at: new Date(Date.now() + 60000).toISOString() },
  ]);
  await page.evaluate((messages) => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [{ id: 'p1', username: 'maria.huber', name: 'Maria', full_name: 'Maria Huber' }], error: null });
      if (name === 'patient_get_messages') return Promise.resolve({ data: messages, error: null });
      return Promise.resolve({ data: [], error: null });
    };
  }, withNewMessage);
  await page.evaluate(async () => { await pollPatientData(); });
  await page.waitForTimeout(300);
  const badge = page.locator('#nav-chat .nav-badge');
  await expect(badge).toBeVisible();
  expect((await badge.textContent()).trim()).toBe('1');
});

test('a patient with zero messages shows no badge at all', async ({ page }) => {
  await setup(page, []);
  await expect(page.locator('#nav-chat .nav-badge')).toBeHidden();
});
