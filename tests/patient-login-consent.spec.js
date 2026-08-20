// Real user request (2026-08-20), following a legal-pages review: the ONE
// unified moment a patient (or a child's guardian, at the keyboard for the
// child's own account) actually consents to health-data processing is now
// their first REAL login with an actual username+password -- not account-
// creation time, which never happens at all for a patient the secretary
// adds directly via "+ Neuer Patient" (see supabase/phase79_patient_login_
// consent.sql's own header for the full gap this closes). Two SEPARATE,
// individually mandatory checkboxes -- not one bundled "I agree to
// everything" -- so consent_records shows exactly which statement was
// agreed to. patients.consent_given_at is the fast per-patient gate every
// login checks; it's deliberately left null for every account that
// predates this feature (no bulk backfill -- see this file's own commit/
// TODO.md entry for why), so an existing account hits the exact same gate a
// brand-new one does, the very next time it logs in for real.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

const POLICY_VERSION = '2.1';

function patientRow(overrides) {
  return Object.assign({
    id: 'p1', username: 'max.mustermann', full_name: 'Max Mustermann', name: 'Max',
    fach: 'Allgemeinmedizin', join_status: 'approved', first_login: false,
    anamnese: { done: true }, is_child: false, consent_given_at: '2026-08-01T10:00:00Z',
  }, overrides);
}

async function setupLogin(page, patient) {
  await installMockSupabase(page, { practice_settings: [{ id: true }], patients: [patient] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  page.on('dialog', d => d.dismiss());
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__rpcCalls = [];
    sb.auth.signInWithPassword = () => Promise.resolve({ data: { user: { id: 'auth-p1' } }, error: null });
    sb.rpc = (name, args) => {
      window.__rpcCalls.push({ name, args });
      // Also mirrored into sessionStorage -- a direct-login case navigates
      // this same tab straight to patient.html (see completeDirectPatientLogin()),
      // which destroys window.__rpcCalls; sessionStorage survives that
      // navigation (same pattern guardian-migrated-login-flow.spec.js's own
      // post-navigation assertions already rely on).
      const log = JSON.parse(sessionStorage.getItem('__rpcCallLog') || '[]');
      log.push(name);
      sessionStorage.setItem('__rpcCallLog', JSON.stringify(log));
      const p = window.__store.patients.find(x => x.id === 'p1');
      if (name === 'patient_login_precheck') return Promise.resolve({ data: 'p_p1@patients.smartordi.internal', error: null });
      if (name === 'patient_get_profile') {
        return Promise.resolve({ data: [{
          id: p.id, username: p.username, full_name: p.full_name, name: p.name,
          first_login: p.first_login, join_status: p.join_status, join_note: null,
          anamnese: p.anamnese, is_child: p.is_child, consent_given_at: p.consent_given_at,
        }], error: null });
      }
      if (name === 'patient_mark_password_changed') { p.first_login = false; return Promise.resolve({ data: true, error: null }); }
      if (name === 'patient_change_username') { p.username = String(args.p_new_username || '').toLowerCase().trim(); return Promise.resolve({ data: true, error: null }); }
      if (name === 'patient_record_login_consent') { p.consent_given_at = '2026-08-20T09:00:00Z'; return Promise.resolve({ data: true, error: null }); }
      if (name === 'check_join_request_status') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
  });
  await page.fill('#username', patient.username);
  await page.fill('#password', 'demo123');
  await page.click('#loginBtn');
  // doLogin()'s real logic runs inside its own 900ms setTimeout.
  await page.waitForTimeout(1600);
}

test('a brand-new account\'s first login shows both consent checkboxes alongside the password fields, and rejects submission until both are checked', async ({ page }) => {
  const patient = patientRow({ first_login: true, consent_given_at: null, anamnese: null });
  await setupLogin(page, patient);
  const shown = await page.evaluate(() => ({
    consentVisible: getComputedStyle(document.getElementById('consentGroup')).display !== 'none',
    pwVisible: getComputedStyle(document.getElementById('newPwGroup')).display !== 'none',
    processingText: document.getElementById('consentProcessingLabel').textContent,
    accuracyText: document.getElementById('consentAccuracyLabel').textContent,
  }));
  expect(shown.consentVisible).toBe(true);
  expect(shown.pwVisible).toBe(true);
  expect(shown.processingText).toContain('Gesundheitsdaten');
  expect(shown.accuracyText).toContain('Verantwortung');

  await page.fill('#newPw', 'neuesPasswort1');
  await page.fill('#confirmPw', 'neuesPasswort1');
  await page.evaluate(() => saveNewPw());
  await page.waitForTimeout(300);
  const rejected = await page.evaluate(() => ({
    calls: window.__rpcCalls.map(c => c.name),
    errorShown: document.getElementById('errorMsg2').classList.contains('show'),
    changepwStillActive: document.getElementById('screen-changepw').classList.contains('active'),
  }));
  expect(rejected.calls).not.toContain('patient_record_login_consent');
  expect(rejected.calls).not.toContain('patient_mark_password_changed');
  expect(rejected.errorShown).toBe(true);
  expect(rejected.changepwStillActive).toBe(true);
});

test('checking both boxes on a brand-new account\'s first login records BOTH consent types with the right policy version, saves the password, and continues to Anamnese', async ({ page }) => {
  const patient = patientRow({ first_login: true, consent_given_at: null, anamnese: null });
  await setupLogin(page, patient);
  await page.check('#consentProcessing');
  await page.check('#consentAccuracy');
  await page.fill('#newPw', 'neuesPasswort1');
  await page.fill('#confirmPw', 'neuesPasswort1');
  await page.evaluate(() => saveNewPw());
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => ({
    calls: window.__rpcCalls.map(c => ({ name: c.name, args: c.args })),
    anamneseActive: document.getElementById('screen-anamnese').classList.contains('active'),
  }));
  const consentCall = result.calls.find(c => c.name === 'patient_record_login_consent');
  expect(consentCall).toBeTruthy();
  expect(consentCall.args.p_policy_version).toBe(POLICY_VERSION);
  expect(result.calls.map(c => c.name)).toContain('patient_mark_password_changed');
  expect(result.anamneseActive).toBe(true);
});

test('an existing patient whose password was just reset (already consented before) sees NO consent checkboxes -- only the password fields, unaffected by this feature', async ({ page }) => {
  const patient = patientRow({ first_login: true, consent_given_at: '2026-07-01T00:00:00Z' });
  await setupLogin(page, patient);
  const shown = await page.evaluate(() => ({
    consentVisible: getComputedStyle(document.getElementById('consentGroup')).display !== 'none',
    pwVisible: getComputedStyle(document.getElementById('newPwGroup')).display !== 'none',
  }));
  expect(shown.consentVisible).toBe(false);
  expect(shown.pwVisible).toBe(true);

  await page.fill('#newPw', 'neuesPasswort1');
  await page.fill('#confirmPw', 'neuesPasswort1');
  await page.evaluate(() => saveNewPw());
  await page.waitForTimeout(300);
  const calls = await page.evaluate(() => window.__rpcCalls.map(c => c.name));
  expect(calls).not.toContain('patient_record_login_consent');
  expect(calls).toContain('patient_mark_password_changed');
});

test('an existing, never-consented account (predates this feature, Anamnese already done) sees a CONSENT-ONLY screen -- no password fields -- and lands directly in patient.html once both boxes are checked', async ({ page }) => {
  const patient = patientRow({ first_login: false, consent_given_at: null, anamnese: { done: true } });
  await setupLogin(page, patient);
  const shown = await page.evaluate(() => ({
    changepwActive: document.getElementById('screen-changepw').classList.contains('active'),
    consentVisible: getComputedStyle(document.getElementById('consentGroup')).display !== 'none',
    pwVisible: getComputedStyle(document.getElementById('newPwGroup')).display !== 'none',
    title: document.getElementById('changePwTitle').textContent,
  }));
  expect(shown.changepwActive).toBe(true);
  expect(shown.consentVisible).toBe(true);
  expect(shown.pwVisible).toBe(false);
  expect(shown.title).toBe('Ihre Zustimmung ist erforderlich');

  await page.check('#consentProcessing');
  await page.check('#consentAccuracy');
  await page.evaluate(() => saveNewPw());
  await page.waitForURL('**/patient.html', { timeout: 5000 });
  const result = await page.evaluate(() => JSON.parse(sessionStorage.getItem('smartordi_user') || 'null'));
  expect(result.username).toBe('max.mustermann');
});

test('an existing, never-consented, self-registered account whose Anamnese is still pending sees the SAME consent-only screen first, then continues into Anamnese (not straight into patient.html)', async ({ page }) => {
  const patient = patientRow({ first_login: false, consent_given_at: null, anamnese: null, join_status: 'approved' });
  await setupLogin(page, patient);
  const before = await page.evaluate(() => ({
    consentVisible: getComputedStyle(document.getElementById('consentGroup')).display !== 'none',
    anamneseActive: document.getElementById('screen-anamnese').classList.contains('active'),
  }));
  expect(before.consentVisible).toBe(true);
  expect(before.anamneseActive).toBe(false);

  await page.check('#consentProcessing');
  await page.check('#consentAccuracy');
  await page.evaluate(() => saveNewPw());
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    calls: window.__rpcCalls.map(c => c.name),
    anamneseActive: document.getElementById('screen-anamnese').classList.contains('active'),
  }));
  expect(after.calls).toContain('patient_record_login_consent');
  expect(after.anamneseActive).toBe(true);
});

test('a normal, already-consented returning patient logs straight in -- no consent screen at all, no new RPC call', async ({ page }) => {
  const patient = patientRow({ first_login: false, consent_given_at: '2026-07-01T00:00:00Z', anamnese: { done: true } });
  await setupLogin(page, patient);
  await page.waitForURL('**/patient.html', { timeout: 5000 });
  const calls = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__rpcCallLog') || '[]'));
  expect(calls).not.toContain('patient_record_login_consent');
});

test('a child account\'s consent screen uses guardian-worded text ("Erziehungsberechtigte") instead of the adult wording', async ({ page }) => {
  const patient = patientRow({ id: 'p1', full_name: 'Tom Huber', name: 'Tom', is_child: true, first_login: true, consent_given_at: null, anamnese: null });
  await setupLogin(page, patient);
  const text = await page.evaluate(() => ({
    processing: document.getElementById('consentProcessingLabel').textContent,
    accuracy: document.getElementById('consentAccuracyLabel').textContent,
  }));
  expect(text.processing).toContain('Erziehungsberechtigte');
  expect(text.processing).toContain('meines Kindes');
  expect(text.accuracy).toContain('Erziehungsberechtigte');
});

// ── patient.html's own Profil screen (real user request, 2026-08-20): used
// to hardcode "DSGVO-Einwilligung: Erteilt" unconditionally, regardless of
// whether the patient had actually consented to anything at all. ──
async function setupProfile(page, profileRow) {
  // installMockSupabase()'s extraInit runs via page.addInitScript() -- a
  // plain function with no arg-binding support, so it's stringified and
  // re-run inside the browser with NO access to this closure's own
  // variables (profileRow included). Both callers below use the same
  // hardcoded username, matching every other *.spec.js in this repo that
  // hits this same limitation.
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
  }, profileRow);
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);
}

test('patient.html shows a real "Erteilt" (green) for a patient who has actually consented', async ({ page }) => {
  await setupProfile(page, {
    id: 'p1', username: 'maria.huber', name: 'Maria', full_name: 'Maria Huber', dob: '1985-01-01',
    adresse: null, tel: null, email: null, versicherung: 'ÖGK', svnr: 'SVNR1', first_login: false,
    consent_given_at: '2026-08-01T00:00:00Z',
  });
  const state = await page.evaluate(() => ({
    text: document.getElementById('profilDsgvo').textContent,
    color: document.getElementById('profilDsgvo').style.color,
  }));
  expect(state.text).toBe('Erteilt');
  expect(state.color).toBe('rgb(22, 163, 74)');
});

test('patient.html shows the real "Nicht erteilt" (not a fake "Erteilt") for a patient who has not consented', async ({ page }) => {
  await setupProfile(page, {
    id: 'p1', username: 'maria.huber', name: 'Maria', full_name: 'Maria Huber', dob: '1985-01-01',
    adresse: null, tel: null, email: null, versicherung: 'ÖGK', svnr: 'SVNR1', first_login: false,
    consent_given_at: null,
  });
  const state = await page.evaluate(() => ({
    text: document.getElementById('profilDsgvo').textContent,
    color: document.getElementById('profilDsgvo').style.color,
  }));
  expect(state.text).toBe('Nicht erteilt');
  expect(state.color).toBe('rgb(220, 38, 38)');
});
