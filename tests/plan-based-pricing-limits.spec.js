// Regression tests for the 2026-07-29 pricing restructure: PLAN_FEATURES
// moved from doctor.html into vendor/staff-accounts.js (so secretary.html
// can enforce it too) and changed from a 3-tier Basic/Pro/Enterprise
// lineup (with no real enforcement anywhere) into 2 tiers -- Standard
// (250-patient cap, 8 MB uploads) and Enterprise (unlimited patients,
// 25 MB uploads, plus an Enterprise-only annual billing option. Found in
// a pricing audit that the old "Bis 500 Patienten"/"max. 8 MB" bullet
// text never actually blocked anything: no cap existed in code at all.
// (Standard's cap was lowered from 500 to 250 on 2026-08-09, before any
// real practice had subscribed, to create a clearer upgrade incentive.)
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function staffProfile() {
  return { id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' };
}

function manyPatients(n, prefix) {
  return Array.from({ length: n }, (_, i) => ({
    id: (prefix || 'cap') + i, username: (prefix || 'cap') + i,
    full_name: 'Bestandspatient ' + i, name: 'Bestandspatient', join_status: 'approved',
  }));
}

async function setupSecretaryPage(page, plan, extraSeed) {
  await installMockSupabase(page, Object.assign({
    staff_profiles: [staffProfile()],
    practices: [{ id: 'prac1', name: 'Musterordination', plan }],
  }, extraSeed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
}

async function setupDoctorPage(page, plan, extraSeed) {
  await installMockSupabase(page, Object.assign({
    staff_profiles: [staffProfile()],
    practices: [{ id: 'prac1', name: 'Musterordination', plan }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  }, extraSeed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    switchView('clinic');
    toggleKartei();
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    switchKarteiTab('dokumente');
    await renderKarteiDocuments();
  });
}

test.describe('Standard plan: 250-patient cap enforcement', () => {
  test('confirmNewPatient() is blocked once the cap is reached, no new row is created', async ({ page }) => {
    await setupSecretaryPage(page, 'standard', { patients: manyPatients(250) });
    await page.evaluate(() => openNewPatientModal());
    await page.fill('#npVorname', 'Neuer');
    await page.fill('#npNachname', 'Patient');
    await page.fill('#npAdresse', 'Teststr. 1, 1010 Wien');
    await page.fill('#npGeburtsdatum', '1990-01-01');
    await page.fill('#npTelefon', '+43 1 2345678');
    const result = await page.evaluate(async () => {
      await confirmNewPatient();
      await new Promise(r => setTimeout(r, 100));
      return { toastText: document.getElementById('toast')?.textContent || '', count: window.__store.patients.length };
    });
    expect(result.toastText).toContain('Patientenlimit');
    expect(result.count, 'no new patient row should have been created past the cap').toBe(250);
  });

  test('confirmNewPatient() still works exactly at the cap boundary (the 250th patient)', async ({ page }) => {
    await setupSecretaryPage(page, 'standard', { patients: manyPatients(249) });
    await page.evaluate(() => openNewPatientModal());
    await page.fill('#npVorname', 'Neuer');
    await page.fill('#npNachname', 'Patient');
    await page.fill('#npAdresse', 'Teststr. 1, 1010 Wien');
    await page.fill('#npGeburtsdatum', '1990-01-01');
    await page.fill('#npTelefon', '+43 1 2345678');
    const result = await page.evaluate(async () => {
      await confirmNewPatient();
      await new Promise(r => setTimeout(r, 100));
      return { count: window.__store.patients.length, created: window.__store.patients.find(p => p.full_name === 'Neuer Patient') };
    });
    expect(result.count).toBe(250);
    expect(result.created, 'the 250th patient must still be allowed in').toBeTruthy();
  });

  test('approveJoinRequest() is blocked once the cap is reached; the request stays pending', async ({ page }) => {
    await setupSecretaryPage(page, 'standard', {
      patients: manyPatients(250),
      patient_join_requests: [{ id: 'jr1', username: 'neuer.patient', vorname: 'Neuer', full_name: 'Neuer Patient', adresse: 'Musterstr 1', svnr: '1234567890', pw_hash: 'hash', status: 'pending', submitted_at: '2026-07-01T10:00:00Z' }],
    });
    const result = await page.evaluate(async () => {
      await approveJoinRequest('neuer.patient');
      await new Promise(r => setTimeout(r, 100));
      return {
        toastText: document.getElementById('toast')?.textContent || '',
        request: window.__store.patient_join_requests.find(r => r.username === 'neuer.patient'),
        patientRow: window.__store.patients.find(p => p.username === 'neuer.patient'),
      };
    });
    expect(result.toastText).toContain('Patientenlimit');
    expect(result.request.status, 'the request must stay pending, not silently get approved past the cap').toBe('pending');
    expect(result.patientRow, 'no patient identity should have been created').toBeFalsy();
  });
});

test.describe('Enterprise plan: no patient cap', () => {
  test('confirmNewPatient() succeeds well past the Standard plan\'s 250-patient threshold', async ({ page }) => {
    await setupSecretaryPage(page, 'enterprise', { patients: manyPatients(600) });
    await page.evaluate(() => openNewPatientModal());
    await page.fill('#npVorname', 'Neuer');
    await page.fill('#npNachname', 'Patient');
    await page.fill('#npAdresse', 'Teststr. 1, 1010 Wien');
    await page.fill('#npGeburtsdatum', '1990-01-01');
    await page.fill('#npTelefon', '+43 1 2345678');
    const result = await page.evaluate(async () => {
      await confirmNewPatient();
      await new Promise(r => setTimeout(r, 100));
      return { count: window.__store.patients.length };
    });
    expect(result.count).toBe(601);
  });
});

test.describe('CSV bulk import respects the patient cap mid-batch', () => {
  test('stops creating NEW patients once the cap is hit, but still updates an existing matched patient in the same import', async ({ page }) => {
    await setupSecretaryPage(page, 'standard', {
      patients: manyPatients(249).concat([
        { id: 'existing-p1', username: 'josef.bauer', full_name: 'Josef Bauer', name: 'Josef', svnr: '4567180452', dob: '1952-04-18', join_status: 'approved' },
      ]),
    });
    // 249 pre-existing + Josef = 250, already AT the cap. Row 1 (new
    // patient) must therefore be rejected immediately -- there is no
    // remaining slot at all. Row 2 (also new) must likewise be skipped.
    // Row 3 matches the already-existing Josef Bauer by SVNr -- an UPDATE,
    // not a new row, so it must still succeed despite the exhausted cap.
    const csv = 'Vorname,Nachname,SVNr\n'
      + 'Erste,Neue,1112223334\n'
      + 'Zweite,Neue,5556667778\n'
      + 'Josef,Bauer,4567180452';
    const result = await page.evaluate(async (csvText) => {
      await patientsReady;
      document.getElementById('importCsvText').value = csvText;
      proceedToMapping();
      await confirmImport();
      await new Promise(r => setTimeout(r, 100));
      return {
        patients: window.__store.patients,
        summary: document.getElementById('importResultSummary').textContent,
        lastResults: window._lastImportResults,
      };
    }, csv);
    expect(result.patients.filter(p => p.full_name === 'Erste Neue'), 'row 1 must be skipped -- the cap was already exhausted').toHaveLength(0);
    expect(result.patients.filter(p => p.full_name === 'Zweite Neue'), 'row 2 must be skipped for the same reason').toHaveLength(0);
    expect(result.patients.find(p => p.id === 'existing-p1').full_name, 'row 3 (existing patient update) must still succeed').toBe('Josef Bauer');
    const row1Result = result.lastResults.find(r => r.name === 'Erste Neue');
    expect(row1Result.limitReached).toBe(true);
    expect(result.summary).toContain('Patientenlimit');
  });

  test('a bulk import that only crosses the cap partway through still creates patients up to the limit', async ({ page }) => {
    await setupSecretaryPage(page, 'standard', { patients: manyPatients(249) });
    // Exactly one remaining slot: row 1 must be created (patient #250), row
    // 2 must be rejected (would be #251).
    const csv = 'Vorname,Nachname\nErste,Neue\nZweite,Neue';
    const result = await page.evaluate(async (csvText) => {
      await patientsReady;
      document.getElementById('importCsvText').value = csvText;
      proceedToMapping();
      await confirmImport();
      await new Promise(r => setTimeout(r, 100));
      return { patients: window.__store.patients, lastResults: window._lastImportResults };
    }, csv);
    expect(result.patients.filter(p => p.full_name === 'Erste Neue'), 'row 1 uses the last remaining slot').toHaveLength(1);
    expect(result.patients.filter(p => p.full_name === 'Zweite Neue'), 'row 2 has no slot left').toHaveLength(0);
    expect(result.lastResults.find(r => r.name === 'Zweite Neue').limitReached).toBe(true);
  });
});

test.describe('Plan-dependent upload size limits', () => {
  test('Standard plan keeps the 8 MB Kartei upload cap', async ({ page }) => {
    await setupDoctorPage(page, 'standard');
    const bigBuffer = Buffer.alloc(8 * 1024 * 1024 + 1);
    await page.fill('#kDokTitel', 'Ein Titel');
    await page.setInputFiles('#kDokFile', { name: 'big.pdf', mimeType: 'application/pdf', buffer: bigBuffer });
    const result = await page.evaluate(async () => {
      await uploadKarteiDocument();
      return { toastText: document.getElementById('toast')?.textContent || '', rows: window.__store.patient_documents.length };
    });
    expect(result.toastText).toContain('zu groß');
    expect(result.toastText).toContain('8 MB');
    expect(result.rows).toBe(0);
  });

  test('Enterprise plan raises the Kartei upload cap to 25 MB (a file over 8 MB but under 25 MB is accepted)', async ({ page }) => {
    // A 20 MB buffer's setInputFiles()/base64 round-trip is genuinely slow
    // under CI/sandbox load -- the default 30s timeout is comfortable
    // locally but flaky there. Bumped for these two large-buffer tests only.
    test.setTimeout(90000);
    await setupDoctorPage(page, 'enterprise');
    const midBuffer = Buffer.alloc(20 * 1024 * 1024);
    await page.fill('#kDokTitel', 'Großer Befund');
    await page.setInputFiles('#kDokFile', { name: 'big.pdf', mimeType: 'application/pdf', buffer: midBuffer });
    const result = await page.evaluate(async () => {
      await uploadKarteiDocument();
      await new Promise(r => setTimeout(r, 100));
      return { toastText: document.getElementById('toast')?.textContent || '', doc: window.__store.patient_documents[0] };
    });
    expect(result.toastText).toContain('hochgeladen');
    expect(result.doc).toBeTruthy();
  });

  test('Enterprise plan still rejects a file over its own 25 MB cap', async ({ page }) => {
    test.setTimeout(90000);
    await setupDoctorPage(page, 'enterprise');
    const tooBig = Buffer.alloc(25 * 1024 * 1024 + 1);
    await page.fill('#kDokTitel', 'Zu groß');
    await page.setInputFiles('#kDokFile', { name: 'huge.pdf', mimeType: 'application/pdf', buffer: tooBig });
    const result = await page.evaluate(async () => {
      await uploadKarteiDocument();
      return { toastText: document.getElementById('toast')?.textContent || '', rows: window.__store.patient_documents.length };
    });
    expect(result.toastText).toContain('zu groß');
    expect(result.toastText).toContain('25 MB');
    expect(result.rows).toBe(0);
  });

  test('the Kartei upload-form labels reflect the plan\'s actual cap', async ({ page }) => {
    await setupDoctorPage(page, 'enterprise');
    const labels = await page.evaluate(() => ({
      dok: document.getElementById('kDokMaxLabel').textContent,
      labor: document.getElementById('kLaborMaxLabel').textContent,
    }));
    expect(labels.dok).toContain('25 MB');
    expect(labels.labor).toContain('25 MB');
  });

  test('secretary.html bulk document import enforces the plan-dependent cap too, not a flat 8 MB', async ({ page }) => {
    await setupSecretaryPage(page, 'enterprise');
    const cap = await page.evaluate(() => getPlanUploadMaxBytes());
    expect(cap).toBe(25 * 1024 * 1024);
  });
});
