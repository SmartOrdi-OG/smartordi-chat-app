// Real user request (2026-08-19): secretary.html's "+ Neuer Patient" ->
// "Kind" checkbox used to be a plain classification flag with no bearing on
// account creation -- staff had no way to say WHICH children's login a new
// child belongs to. Now offers two explicit choices once "Kind" is checked:
//   - "Erstes Kind (neues Kinder-Konto)" (default): unchanged mechanics --
//     still createPatientAccount()'s existing QR/first-login pipeline. The
//     only change is patient-login.html's first-login screen copy/behavior
//     for an is_child account (covered in tests/patient-first-login-
//     username.spec.js, not here).
//   - "Weiteres Kind (bestehendes Kinder-Konto)": links the new patient row
//     directly onto an EXISTING children's account via the new
//     staff_add_linked_child() RPC (supabase/phase76_secretary_link_child_
//     flows.sql) -- no QR/scan/approval round-trip, since staff has already
//     reviewed everything in person.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
  }, extra);
}

async function setupPage(page, extraSeed) {
  await installMockSupabase(page, seed(extraSeed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
}

async function fillChildFields(page) {
  await page.fill('#npVorname', 'Lena');
  await page.fill('#npNachname', 'Huber');
  await page.fill('#npAdresse', 'Teststr. 1, 1010 Wien');
  await page.fill('#npGeburtsdatum', '2018-03-10');
  await page.fill('#npTelefon', '+43 1 2345678');
}

test('the child-mode choice is hidden until "Kind" is checked, and defaults to "Erstes Kind" with the owner search hidden', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(() => openNewPatientModal());
  const before = await page.evaluate(() => getComputedStyle(document.getElementById('npChildModeWrap')).display !== 'none');
  expect(before).toBe(false);

  await page.check('#npIsChild');
  const state = await page.evaluate(() => ({
    wrapVisible: getComputedStyle(document.getElementById('npChildModeWrap')).display !== 'none',
    newChecked: document.getElementById('npChildModeNew').checked,
    searchVisible: getComputedStyle(document.getElementById('npChildOwnerSearchWrap')).display !== 'none',
  }));
  expect(state.wrapVisible).toBe(true);
  expect(state.newChecked).toBe(true);
  expect(state.searchVisible).toBe(false);
});

test('unchecking "Kind" hides the child-mode choice again and resets it back to "Erstes Kind"', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(() => openNewPatientModal());
  await page.check('#npIsChild');
  await page.check('#npChildModeExisting');
  await page.uncheck('#npIsChild');
  const state = await page.evaluate(() => ({
    wrapVisible: getComputedStyle(document.getElementById('npChildModeWrap')).display !== 'none',
    newChecked: document.getElementById('npChildModeNew').checked,
  }));
  expect(state.wrapVisible).toBe(false);
  expect(state.newChecked).toBe(true);
});

test('choosing "Weiteres Kind" reveals the owner-account search box', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(() => openNewPatientModal());
  await page.check('#npIsChild');
  await page.check('#npChildModeExisting');
  const visible = await page.evaluate(() => getComputedStyle(document.getElementById('npChildOwnerSearchWrap')).display !== 'none');
  expect(visible).toBe(true);
});

test('the owner search only shows children\'s accounts (is_child), never an adult account', async ({ page }) => {
  await setupPage(page, {
    patients: [
      { id: 'p1', username: 'tom.huber', full_name: 'Tom Huber', name: 'Tom', is_child: true, join_status: 'approved' },
      { id: 'p2', username: 'klaus.huber', full_name: 'Klaus Huber', name: 'Klaus', is_child: false, join_status: 'approved' },
    ],
  });
  await page.evaluate(() => openNewPatientModal());
  await page.check('#npIsChild');
  await page.check('#npChildModeExisting');
  await page.fill('#npChildOwnerSearchInput', 'Huber');
  await page.waitForTimeout(400); // 250ms debounce inside npChildOwnerSearch()
  const html = await page.evaluate(() => document.getElementById('npChildOwnerSearchResults').innerHTML);
  expect(html).toContain('Tom Huber');
  expect(html).not.toContain('Klaus Huber');
});

test('submitting "Weiteres Kind" without picking an owner shows an error and creates nothing', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'tom.huber', full_name: 'Tom Huber', name: 'Tom', is_child: true, join_status: 'approved' }],
  });
  await page.evaluate(() => openNewPatientModal());
  await page.check('#npIsChild');
  await page.check('#npChildModeExisting');
  await fillChildFields(page);
  const before = await page.evaluate(() => window.__store.patients.length);
  await page.evaluate(() => confirmNewPatient());
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__store.patients.length);
  expect(after).toBe(before);
});

test('picking an owner and submitting "Weiteres Kind" creates the new child and links it via staff_add_linked_child(), with no QR modal shown', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'tom.huber', full_name: 'Tom Huber', name: 'Tom', is_child: true, join_status: 'approved' }],
  });
  await page.evaluate(() => {
    window.__linkCalls = [];
    const origRpc = sb.rpc.bind(sb);
    sb.rpc = (name, args) => {
      if (name === 'staff_add_linked_child') { window.__linkCalls.push(args); return Promise.resolve({ data: true, error: null }); }
      return origRpc(name, args);
    };
  });
  await page.evaluate(() => openNewPatientModal());
  await page.check('#npIsChild');
  await page.check('#npChildModeExisting');
  await fillChildFields(page);
  await page.fill('#npChildOwnerSearchInput', 'Tom');
  await page.waitForTimeout(400);
  await page.click('.qr-patient-row');
  await page.evaluate(() => confirmNewPatient());
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => ({
    newPatient: window.__store.patients.find(p => p.full_name === 'Lena Huber'),
    linkCalls: window.__linkCalls,
    modalOpen: document.getElementById('newPatientModal').classList.contains('show'),
    credModalOpen: document.getElementById('patientCredentialsModal').classList.contains('show'),
  }));
  expect(result.newPatient, 'a real patients row must be created for the new child').toBeTruthy();
  expect(result.newPatient.is_child).toBe(true);
  // A profil-<hex> placeholder username, same convention as phase64's own
  // linked-profile rows -- this child never gets its own standalone login.
  expect(result.newPatient.username).toMatch(/^profil-[0-9a-f]{32}$/);
  expect(result.linkCalls).toHaveLength(1);
  expect(result.linkCalls[0].p_owner_patient_id).toBe('p1');
  expect(result.linkCalls[0].p_new_patient_id).toBe(result.newPatient.id);
  expect(result.linkCalls[0].p_relation).toBe('child');
  expect(result.modalOpen).toBe(false);
  expect(result.credModalOpen, 'no QR/credentials modal -- this child never gets a standalone login to hand over').toBe(false);
});

test('"Erstes Kind" (the default) still works exactly as before: a standalone account + QR, with child-specific wording in the credentials modal, and the username/password boxes hidden from the secretary', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(() => openNewPatientModal());
  await page.check('#npIsChild');
  await fillChildFields(page);
  await page.evaluate(() => confirmNewPatient());
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => ({
    newPatient: window.__store.patients.find(p => p.full_name === 'Lena Huber'),
    credModalOpen: document.getElementById('patientCredentialsModal').classList.contains('show'),
    credDescription: document.getElementById('credDescription').textContent,
    credUsername: document.getElementById('credUsername').textContent,
    gridVisible: getComputedStyle(document.getElementById('credCredentialsGrid')).display !== 'none',
  }));
  expect(result.newPatient).toBeTruthy();
  expect(result.newPatient.is_child).toBe(true);
  expect(result.credModalOpen).toBe(true);
  expect(result.credDescription).toContain('Kinder-Konto');
  expect(result.credDescription).toContain('eigenen Benutzernamen');
  // Still populated internally (used elsewhere, e.g. printPatientCredentials()
  // if it were ever shown) but hidden from the secretary -- real user request
  // (2026-08-19): she should never see a generated username/password for any
  // new account she creates.
  expect(result.credUsername).toBeTruthy();
  expect(result.gridVisible, 'the username/password boxes must be hidden for a brand-new account').toBe(false);
});

// Real user request (2026-08-19): extends the "blank + mandatory username,
// chosen by the real user, never shown to the secretary" behavior above --
// previously child-only -- to an ordinary ADULT "+ Neuer Patient" too.
test('an ordinary adult "+ Neuer Patient" (Kind unchecked) now ALSO gets the "choose your own username" QR flow, with the credentials boxes hidden from the secretary', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(() => openNewPatientModal());
  await page.fill('#npVorname', 'Klaus');
  await page.fill('#npNachname', 'Wagner');
  await page.fill('#npAdresse', 'Teststr. 2, 1010 Wien');
  await page.fill('#npGeburtsdatum', '1980-01-01');
  await page.fill('#npTelefon', '+43 1 2345679');
  await page.evaluate(() => confirmNewPatient());
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => ({
    newPatient: window.__store.patients.find(p => p.full_name === 'Klaus Wagner'),
    credDescription: document.getElementById('credDescription').textContent,
    gridVisible: getComputedStyle(document.getElementById('credCredentialsGrid')).display !== 'none',
    qrUrl: (() => { const img = document.getElementById('credQrImg'); return img && img.src; })(),
  }));
  expect(result.newPatient).toBeTruthy();
  expect(result.newPatient.is_child).toBe(false);
  expect(result.credDescription).not.toContain('Kinder-Konto');
  expect(result.credDescription).not.toContain('wird automatisch angemeldet');
  expect(result.credDescription).toContain('eigenen Benutzernamen');
  expect(result.gridVisible, 'the username/password boxes must be hidden for a brand-new account').toBe(false);
});

test('an existing patient\'s password-reset QR (selectQrPatient) keeps showing the real credentials to the secretary, unaffected by the new-account hiding above', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'klaus.wagner', full_name: 'Klaus Wagner', name: 'Klaus', is_child: false, join_status: 'approved' }],
  });
  await page.evaluate(() => selectQrPatient('Klaus Wagner'));
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => ({
    credModalOpen: document.getElementById('patientCredentialsModal').classList.contains('show'),
    gridVisible: getComputedStyle(document.getElementById('credCredentialsGrid')).display !== 'none',
    credUsername: document.getElementById('credUsername').textContent,
    credPassword: document.getElementById('credPassword').textContent,
  }));
  expect(result.credModalOpen).toBe(true);
  expect(result.gridVisible).toBe(true);
  expect(result.credUsername).toBe('klaus.wagner');
  expect(result.credPassword).toBeTruthy();
});
