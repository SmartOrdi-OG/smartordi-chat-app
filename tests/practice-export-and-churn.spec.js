// Regression tests for the whole-practice structured data export
// (exportPracticeDataZip(), doctor.html Einstellungen "Datenexport" card) --
// built so a practice that decides not to continue with SmartOrdi has a
// real, complete way to take their data with them (see agb.html § 6's
// 60-day post-termination export window, supabase/
// phase43_practice_churn_retention.sql). The churn/anonymization SQL
// itself (anonymize_practice(), run_scheduled_practice_deletions()) is
// real Postgres logic that can't be regression-tested in this mocked-
// Supabase sandbox -- it mirrors the already-reviewed phase17_data_
// retention.sql pattern exactly.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsZipMock } = require('./helpers/jszipStub');

function seed(extra) {
  return Object.assign({
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
  }, extra);
}

async function setupPage(page, staffSession, extra) {
  await installJsZipMock(page);
  // Playwright's addInitScript(fn) serializes the function via .toString()
  // and re-evaluates it with no access to this file's closures -- an arrow
  // function referencing an outer variable (like a staffSession parameter)
  // silently loses that reference in the page, leaving sessionStorage
  // unset (currentStaffSession() then reads null, which
  // isCurrentUserAdmin() treats as "no session = admin"). Building a plain
  // script STRING with the session JSON embedded as a literal (same
  // technique mockScript() itself uses for seed data) avoids the problem
  // entirely.
  const initScript = `sessionStorage.setItem('smartordi_user', ${JSON.stringify(JSON.stringify(staffSession))});
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));`;
  await installMockSupabase(page, seed(extra), initScript);
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
}

test('the Datenexport card and button are hidden for a non-admin staff member', async ({ page }) => {
  await setupPage(page, { role: 'arzt', name: 'Dr. Jonas Berger', username: 'dr.berger', isAdmin: false }, {
    staff_profiles: [{ id: 'u1', vorname: 'Jonas', nachname: 'Berger', full_name: 'Dr. Jonas Berger', role: 'arzt', fach: 'Kardiologie', is_admin: false, email: 'j@a.at', username: 'dr.berger' }],
  });
  await page.evaluate(() => { switchView('settings'); renderTeamCard(); });
  const display = await page.evaluate(() => getComputedStyle(document.getElementById('practiceExportCard')).display);
  expect(display).toBe('none');
});

test('exportPracticeDataZip() refuses for a non-admin even if called directly', async ({ page }) => {
  await setupPage(page, { role: 'arzt', name: 'Dr. Jonas Berger', username: 'dr.berger', isAdmin: false }, {
    staff_profiles: [{ id: 'u1', vorname: 'Jonas', nachname: 'Berger', full_name: 'Dr. Jonas Berger', role: 'arzt', fach: 'Kardiologie', is_admin: false, email: 'j@a.at', username: 'dr.berger' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
  });
  const result = await page.evaluate(async () => {
    await exportPracticeDataZip();
    await new Promise(r => setTimeout(r, 50));
    return { toastText: document.getElementById('toast')?.textContent, zipFiles: window.__lastZipFiles };
  });
  expect(result.toastText).toContain('Nur für Admins');
  expect(result.zipFiles, 'no zip should have been built at all').toBeUndefined();
});

test('exportPracticeDataZip() (admin) exports every patient in the practice as one JSON file each, plus a manifest', async ({ page }) => {
  await setupPage(page, { role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [
      { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', diagnosen: 'Migräne', join_status: 'approved' },
      { id: 'p2', username: 'peter.gruber', full_name: 'Peter Gruber', name: 'Peter', versicherung: 'BVAEB', svnr: '456', dob: '1990-06-15', join_status: 'approved' },
    ],
    patient_impfungen: [{ id: 'i1', patient_id: 'p1', vaccine_key: 'fsme', vaccine_name: 'FSME', datum: '2024-03-15', next_due: null }],
    patient_visits: [{ id: 'v1', patient_id: 'p2', visit_date: '2026-05-10', visit_type: 'Kontrolle', beschwerde: 'Husten', created_at: new Date().toISOString() }],
  });
  const result = await page.evaluate(async () => {
    await Promise.all([patientsReady, impfungenReady, termineReady]);
    await exportPracticeDataZip();
    await new Promise(r => setTimeout(r, 100));
    return { toastText: document.getElementById('toast')?.textContent, zipFiles: window.__lastZipFiles };
  });
  expect(result.toastText).toContain('2 Patient(en) exportiert');
  const filenames = Object.keys(result.zipFiles);
  expect(filenames).toContain('manifest.json');
  const mariaFile = filenames.find(f => f.includes('Huber'));
  const peterFile = filenames.find(f => f.includes('Gruber'));
  expect(mariaFile).toBeTruthy();
  expect(peterFile).toBeTruthy();
  const mariaData = JSON.parse(result.zipFiles[mariaFile]);
  expect(mariaData.stammdaten.svnr).toBe('123');
  expect(mariaData.diagnosen).toBe('Migräne');
  expect(mariaData.impfungen).toHaveLength(1);
  expect(mariaData.impfungen[0].name).toBe('FSME');
  const peterData = JSON.parse(result.zipFiles[peterFile]);
  expect(peterData.stammdaten.svnr).toBe('456');
  expect(peterData.behandlungsverlauf).toHaveLength(1);
  const manifest = JSON.parse(result.zipFiles['manifest.json']);
  expect(manifest.anzahlPatienten).toBe(2);
  expect(manifest.praxis).toBe('Musterordination');
});

// supabase/phase88_complete_practice_deletion.sql: after the lock (trial/
// pilot over) the admin must still be able to export until the deletion
// date -- via practice_export_status()/practice_export_table(), which work
// while the RLS lock on the clinical tables stays in place.
const DAY = 24 * 60 * 60 * 1000;
function lockedSeed(extra) {
  return Object.assign({
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro', trial_start: new Date(Date.now() - 40 * DAY).toISOString(), payment_method: null }],
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
  }, extra);
}
const ADMIN = { role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true };

test('lock overlay offers the export with the German deadline text when the server allows it', async ({ page }) => {
  await installJsZipMock(page);
  const initScript = `sessionStorage.setItem('smartordi_user', ${JSON.stringify(JSON.stringify(ADMIN))});
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));`;
  await installMockSupabase(page, lockedSeed(), initScript);
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  const r = await page.evaluate(async () => {
    await practiceSettingsReady;
    sb.rpc = async (name) => name === 'practice_export_status'
      ? { data: [{ allowed: true, locked: true, export_until: '2026-11-05' }], error: null }
      : { data: null, error: null };
    applyTrialStatus();
    await new Promise(res => setTimeout(res, 100));
    return {
      lock: document.getElementById('trialLockOverlay').style.display,
      box: document.getElementById('trialLockExportBox').style.display,
      text: document.getElementById('trialLockExportText').textContent,
    };
  });
  expect(r.lock).toBe('flex');
  expect(r.box).toBe('block');
  expect(r.text).toBe('Ihr Zugang ist gesperrt. Sie können Ihre Daten bis 05.11.2026 exportieren.');
});

test('lock overlay hides the export when the server says not allowed (e.g. non-admin)', async ({ page }) => {
  await installJsZipMock(page);
  const initScript = `sessionStorage.setItem('smartordi_user', ${JSON.stringify(JSON.stringify(ADMIN))});
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));`;
  await installMockSupabase(page, lockedSeed(), initScript);
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  const r = await page.evaluate(async () => {
    await practiceSettingsReady;
    sb.rpc = async (name) => name === 'practice_export_status'
      ? { data: [{ allowed: false, locked: true, export_until: null }], error: null }
      : { data: null, error: null };
    applyTrialStatus();
    await new Promise(res => setTimeout(res, 100));
    return { lock: document.getElementById('trialLockOverlay').style.display, box: document.getElementById('trialLockExportBox').style.display };
  });
  expect(r.lock).toBe('flex');
  expect(r.box).toBe('none');
});

test('exportPracticeDataZip() adds every practice table via practice_export_table, paging by id', async ({ page }) => {
  await setupPage(page, ADMIN, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
  });
  const result = await page.evaluate(async () => {
    const calls = [];
    // 200 Rezepte on page 1 + 1 on page 2 proves keyset paging; one patient
    // row stands in for a locked practice where direct reads return nothing.
    sb.rpc = async (name, args) => {
      if (name !== 'practice_export_table') return { data: null, error: null };
      calls.push(args);
      if (args.p_table === 'patients') return { data: [{ id: 'p1', full_name: 'Maria Huber', svnr: '123' }], error: null };
      if (args.p_table === 'patient_rezepte') {
        if (!args.p_after) return { data: Array.from({ length: 200 }, (_, i) => ({ id: 'r' + String(i).padStart(3, '0'), med1: 'X' })), error: null };
        return { data: [{ id: 'r999', med1: 'Y' }], error: null };
      }
      return { data: [], error: null };
    };
    await exportPracticeDataZip();
    await new Promise(r => setTimeout(r, 100));
    return { calls, zipFiles: window.__lastZipFiles, toastText: document.getElementById('toast')?.textContent };
  });
  const files = Object.keys(result.zipFiles);
  for (const t of ['patients', 'patient_visits', 'patient_rezepte', 'patient_ueberweisungen', 'patient_lab_results', 'lab_result_uploads', 'patient_documents', 'patient_messages', 'consent_records']) {
    expect(files).toContain('tabellen/' + t + '.json');
  }
  expect(JSON.parse(result.zipFiles['tabellen/patient_rezepte.json'])).toHaveLength(201);
  const rezCalls = result.calls.filter(c => c.p_table === 'patient_rezepte');
  expect(rezCalls).toHaveLength(2);
  expect(rezCalls[1].p_after).toBe('r199');
  const docCall = result.calls.find(c => c.p_table === 'patient_documents');
  expect(docCall.p_limit, 'documents carry PDFs, so they page in small batches').toBe(20);
  const manifest = JSON.parse(result.zipFiles['manifest.json']);
  expect(manifest.tabellen.patient_rezepte).toBe(201);
  expect(manifest.anzahlPatienten).toBe(1);
  expect(result.toastText).toContain('1 Patient(en) exportiert');
});

test('exportPracticeDataZip() reports failure instead of an empty ZIP when nothing could be read', async ({ page }) => {
  await setupPage(page, ADMIN, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
  });
  const result = await page.evaluate(async () => {
    window.__lastZipFiles = undefined;
    sb.rpc = async () => ({ data: null, error: { message: 'export_forbidden' } });
    let downloaded = false;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { downloaded = true; return orig(b); };
    await exportPracticeDataZip();
    await new Promise(r => setTimeout(r, 100));
    return { downloaded, toastText: document.getElementById('toast')?.textContent };
  });
  expect(result.downloaded).toBe(false);
  expect(result.toastText).toContain('Export fehlgeschlagen');
});
