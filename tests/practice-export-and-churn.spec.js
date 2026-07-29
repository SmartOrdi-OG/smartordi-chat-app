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
