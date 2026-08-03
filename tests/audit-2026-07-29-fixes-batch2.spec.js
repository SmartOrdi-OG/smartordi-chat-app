// Regression tests for the Medium/Low-severity findings from the full
// app-wide bug/security audit run on 2026-07-29 (continuing after
// audit-2026-07-29-fixes.spec.js's High-severity batch). The
// patient_book_termin() overlap-check fix (supabase/phase42_patient_book_
// termin_overlap_check.sql) can't be regression-tested in this mocked-
// Supabase sandbox -- it's real Postgres query logic, not client code.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsZipMock } = require('./helpers/jszipStub');

function baseSeed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    practice_settings: [{ id: true }],
  }, extra);
}

// ── Finding: _lookupCache (vendor/patient-data.js) was never invalidated
// after upsertPatientIdentity() -- a patient looked up once this session
// kept returning stale identity data (SVNR/insurance/etc.) even after a
// staff member corrected it via savePatientEdit(). ──
test('secretary.html: correcting a patient\'s identity actually invalidates the session lookup cache', async ({ page }) => {
  await installMockSupabase(page, baseSeed({
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: 'OLD-SVNR', dob: '1985-01-01', join_status: 'approved' }],
  }), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);
  const result = await page.evaluate(async () => {
    await patientsReady;
    // Populate the session cache with the OLD identity, same as opening a
    // patient's Kartei/searching for them once would.
    const before = await findPatientAccountAsync('Maria Huber');
    await upsertPatientIdentity('maria.huber', { svnr: 'NEW-SVNR' });
    const afterCached = findPatientByFullNameCached('Maria Huber');
    const afterAsync = await findPatientAccountAsync('Maria Huber');
    return { beforeSvnr: before && before.svnr, afterCachedSvnr: afterCached && afterCached.svnr, afterAsyncSvnr: afterAsync && afterAsync.svnr };
  });
  expect(result.beforeSvnr).toBe('OLD-SVNR');
  expect(result.afterCachedSvnr, 'the synchronous cached lookup must reflect the correction, not the stale pre-edit value').toBe('NEW-SVNR');
  expect(result.afterAsyncSvnr).toBe('NEW-SVNR');
});

// ── Finding: buildDocPatientMatchIndex()/findPatientForDocRow() (secretary.
// html bulk document import) matched against loadPatients()'s bounded
// PATIENTS_LIST_LIMIT (500) most-recently-active set -- a patient outside
// it (real for any practice with >500 patients) got "Kein passender
// Patient gefunden" even with a manifest SVNr that genuinely matched.
// Converted to a live per-row query; mirrors tests/patients-bounded-list.
// spec.js's own seeding approach. ──
test('secretary.html: bulk document import finds a patient outside the bounded 500-patient list', async ({ page }) => {
  const TOTAL = 502;
  const patients = [];
  for (let i = 0; i < TOTAL; i++) {
    const d = new Date('2020-01-01T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    patients.push({ id: 'p' + i, username: 'patient' + i, full_name: 'Patient Number' + String(i).padStart(4, '0'), name: 'Patient', svnr: String(1000000000 + i), join_status: 'approved', updated_at: d.toISOString() });
  }
  await installJsZipMock(page);
  await installMockSupabase(page, baseSeed({ patients }), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.addInitScript(() => {
    window.__fakeZipFiles = { 'befund_0000.pdf': 'ZmFrZS1wZGYtY29udGVudA==' };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);
  await page.evaluate(() => { openDocImportModal(); });
  await page.setInputFiles('#docImportZipInput', { name: 'export.zip', mimeType: 'application/zip', buffer: Buffer.from('dummy zip bytes') });
  await page.waitForFunction(() => document.getElementById('docImportZipStatus').textContent.includes('Datei(en) im ZIP gefunden'));

  // Patient Number0000 is the OLDEST -- guaranteed outside the 500 bound.
  const csv = 'Dateiname,SV-Nummer,Titel,Kategorie\nbefund_0000.pdf,1000000000,Laborbefund,befund';
  const result = await page.evaluate(async (csvText) => {
    const inBoundedList = 'Patient Number0000' in Object.fromEntries(Object.values(loadPatients()).map(p => [p.fullName, true]));
    document.getElementById('docImportCsvText').value = csvText;
    proceedToDocMapping();
    await confirmDocImport();
    return { inBoundedList, docs: window.__store.patient_documents };
  }, csv);
  expect(result.inBoundedList, 'sanity check: this patient really is outside the bounded list').toBe(false);
  expect(result.docs).toHaveLength(1);
  expect(result.docs[0].patient_id).toBe('p0');
});

// ── Finding: confirmImport()'s addImpfungEntry()/createPatientVisit() calls
// only console.error'd on failure, with no equivalent to syncFailed's ⚠
// marker -- a row could report as a clean success even though a
// vaccination/visit record silently never saved. ──
test('secretary.html: a failed Impfung/Verlauf write during CSV import is flagged, not silently swallowed', async ({ page }) => {
  await installMockSupabase(page, baseSeed({}), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);

  const csv = 'Vorname,Nachname,Geburtsdatum,Impfungen\nMaria,Huber,14.03.1985,Grippe:2024-01-01';
  const result = await page.evaluate(async (csvText) => {
    await patientsReady;
    window.__forceError = { patient_impfungen: 'simulated failure' };
    document.getElementById('importCsvText').value = csvText;
    proceedToMapping();
    await confirmImport();
    await new Promise(r => setTimeout(r, 100));
    return { results: window._lastImportResults, summary: document.getElementById('importResultSummary').textContent };
  }, csv);
  expect(result.results[0].historyFailed, 'the row must be flagged since the Impfung insert failed').toBe(true);
  expect(result.summary).toContain('Impfung/ein Verlaufseintrag konnte nicht gespeichert werden');
});

// ── Finding: the SAME CSV cell listing the same vaccine+date twice
// inserted it twice for an EXISTING patient -- the dedup snapshot
// ("already") was only ever the pre-import state, never updated as the
// loop added its own entries within that same pass. ──
test('secretary.html: duplicate vaccine entries within one CSV cell are not both inserted', async ({ page }) => {
  await installMockSupabase(page, baseSeed({
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', svnr: '1234140385', dob: '1985-03-14', join_status: 'approved' }],
  }), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);

  const csv = 'Vorname,Nachname,Geburtsdatum,SVNr,Impfungen\nMaria,Huber,14.03.1985,1234140385,"Grippe:2024-01-01;Grippe:2024-01-01"';
  const result = await page.evaluate(async (csvText) => {
    await patientsReady;
    document.getElementById('importCsvText').value = csvText;
    proceedToMapping();
    await confirmImport();
    await new Promise(r => setTimeout(r, 100));
    return window.__store.patient_impfungen.filter(i => i.patient_id === 'p1');
  }, csv);
  expect(result, 'the duplicate entry within the same cell must only be inserted once').toHaveLength(1);
});

// ── Finding: patient.html's todayStr() used new Date().toISOString(),
// always UTC -- right after each local midnight (Austria is UTC+1/+2) this
// returned the PREVIOUS day, desyncing the calendar/upcoming-termin split
// from the actual local date. Now uses local Date getters via dateStr(),
// same fix already applied to doctor.html's tuDateStr(). ──
test.describe('timezone-sensitive todayStr()', () => {
  test.use({ timezoneId: 'Europe/Vienna' });

  test('patient.html: todayStr() reports the local calendar date, not the UTC one', async ({ page }) => {
    await installMockSupabase(page, baseSeed({
      patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
    }), () => {
      sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria.huber' }));
    });
    // Freeze "now" to 2026-08-15T23:30:00Z -- 01:30 on the 16th in Vienna
    // (UTC+2 in August), so a UTC-based todayStr() and a local-based one
    // disagree on which calendar day it is.
    await page.addInitScript(() => {
      const fixedMs = new Date('2026-08-15T23:30:00Z').getTime();
      const RealDate = Date;
      class FakeDate extends RealDate {
        constructor(...args) { if (args.length === 0) super(fixedMs); else super(...args); }
        static now() { return fixedMs; }
      }
      window.Date = FakeDate;
    });
    await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
    await page.waitForTimeout(800);
    const result = await page.evaluate(() => ({ today: todayStr() }));
    expect(result.today, 'must report the Vienna-local date (16th), not the UTC date (15th)').toBe('2026-08-16');
  });
});

// ── Finding: a real (Supabase-backed) multi-child guardian had no in-app
// way to switch children -- the "Kind wechseln" button only ever appeared
// for the legacy local-only shadow-account flow. patient-login.html's
// selectChildProfile() now sets a smartordi_guardian_session flag; patient.
// html uses it to show the button and offer a real picker backed by
// guardianGetChildren()/guardianSelectChild(). ──
test('patient.html: a real guardian session shows "Kind wechseln" and can actually switch to a different child', async ({ page }) => {
  await installMockSupabase(page, baseSeed({}), () => {
    // A real (Supabase-backed) session needs the patient token set (same
    // as patient-login.html's selectChildProfile() does via setPatientToken)
    // -- without it, initPatientData() never even attempts the remote
    // profile fetch this whole render path depends on.
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'patient', name: 'Leo', username: 'leo.bauer' }));
    sessionStorage.setItem('smartordi_guardian_session', '1');
    sessionStorage.setItem('smartordi_patient_token', '1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [{ id: 'p1', username: 'leo.bauer', name: 'Leo', full_name: 'Leo Bauer', dob: '2018-04-01' }], error: null });
      if (name === 'guardian_get_children') return Promise.resolve({ data: [
        { id: 'p1', username: 'leo.bauer', name: 'Leo', full_name: 'Leo Bauer', fach: null, dob: '2018-04-01' },
        { id: 'p2', username: 'mia.bauer', name: 'Mia', full_name: 'Mia Bauer', fach: null, dob: '2020-09-10' },
      ], error: null });
      if (name === 'guardian_select_child') return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: [], error: null });
    };
  });
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);

  const hasButtonBefore = await page.locator('#topbarSwitchChild').count();
  expect(hasButtonBefore, 'the switch-child button must appear for a real guardian session too').toBe(1);

  await page.click('#topbarSwitchChild');
  await page.waitForSelector('#childPickerOverlay');
  const rows = await page.locator('#childPickerOverlay [onclick^="selectRealChild"]').count();
  expect(rows).toBe(2);

  await page.click('#childPickerOverlay >> text=Mia Bauer');
  await page.waitForTimeout(300);
  const session = await page.evaluate(() => JSON.parse(sessionStorage.getItem('smartordi_user')));
  expect(session.username).toBe('mia.bauer');
  expect(await page.locator('#childPickerOverlay').count()).toBe(0);
});
