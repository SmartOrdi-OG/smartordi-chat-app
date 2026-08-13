// Regression test for Phase 4 of the Praxisdaten-Migration feature: writing
// the already-parsed #D/#V/#L entries (Phase 3) into Verlauf/Rezepte/
// Laborwerte once a patient is created/matched (doctor.html's
// confirmMigrationImport(), see importMigrationSubRecords() and its three
// per-block helpers), plus surfacing imported lab results in the Kartei
// Labor tab (vendor/kartei-labor.js's karteiLaborResultsHtml()).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsZipMock } = require('./helpers/jszipStub');

function ends1LineDated(patientNr, block, field, date, time, value) {
  return String(patientNr).padStart(10, '0') + '#' + block + field + date + time + value + '\r\n';
}
function ends1Line(patientNr, field, value) {
  return String(patientNr).padStart(10, '0') + '#P' + field + '00000000' + '0000' + value + '\r\n';
}

async function setupAndImport(page, sampleText, seedPatients) {
  const sampleBase64 = Buffer.from(sampleText, 'utf8').toString('base64');
  await installJsZipMock(page);
  await page.addInitScript((b64) => { window.__fakeZipFiles = { 'normdata.txt': b64 }; }, sampleBase64);
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: seedPatients || [],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-settings').classList.add('active');
    openMigrationImportModal();
  });
  await page.setInputFiles('#migrationZipInput', { name: 'export.zip', mimeType: 'application/zip', buffer: Buffer.from('dummy') });
  await page.waitForFunction(() => document.getElementById('migrationZipStatus').textContent.includes('Format erkannt'));
  await page.evaluate(() => confirmMigrationImport());
  await page.waitForFunction(() => document.getElementById('migrationResultsArea').style.display === 'block');
}

test('a new patient with #D/#V/#L entries gets Verlauf/Rezepte/Laborwerte written, and the lab result shows in the Labor tab', async ({ page }) => {
  const text =
    ends1Line(1, 'FNM', 'Mustermann') + ends1Line(1, 'VNM', 'Max') +
    ends1LineDated(1, 'D', 'TXT', '10012020', '1000', 'Diabetes mellitus') +
    ends1LineDated(1, 'D', 'WHO', '10012020', '1000', 'E11') +
    ends1LineDated(1, 'D', 'ART', '10012020', '1000', '1') +
    ends1LineDated(1, 'V', 'TXT', '01022021', '0900', 'Ibuprofen 400mg') +
    ends1LineDated(1, 'V', 'ANZ', '01022021', '0900', '2') +
    ends1LineDated(1, 'V', 'SIG', '01022021', '0900', '1-0-1') +
    ends1LineDated(1, 'L', 'BEZ', '05012022', '0800', 'Hämoglobin') +
    ends1LineDated(1, 'L', 'WRT', '05012022', '0800', '14.2') +
    ends1LineDated(1, 'L', 'GRP', '05012022', '0800', 'Hämatologie');
  await setupAndImport(page, text, []);

  const summary = await page.locator('#migrationResultSummary').textContent();
  expect(summary).toContain('1 Diagnose(n) in Verlauf übernommen');
  expect(summary).toContain('1 Verordnung(en) in Rezepte übernommen');
  expect(summary).toContain('1 Laborbefund(e) übernommen');

  const state = await page.evaluate(() => {
    const patient = window.__store.patients.find(p => p.full_name === 'Max Mustermann');
    return {
      patientId: patient && patient.id,
      visits: window.__store.patient_visits,
      rezepte: window.__store.patient_rezepte,
      labResults: window.__store.patient_lab_results,
    };
  });
  expect(state.patientId).toBeTruthy();

  expect(state.visits).toHaveLength(1);
  expect(state.visits[0].patient_id).toBe(state.patientId);
  expect(state.visits[0].visit_date).toBe('2020-01-10');
  expect(state.visits[0].diagnose).toBe('Diabetes mellitus');
  expect(state.visits[0].notes).toContain('WHO-Code: E11');
  expect(state.visits[0].notes).toContain('Dauerdiagnose');

  expect(state.rezepte).toHaveLength(1);
  expect(state.rezepte[0].patient_id).toBe(state.patientId);
  expect(state.rezepte[0].med1).toBe('Ibuprofen 400mg');
  expect(state.rezepte[0].packungen1).toBe('2');
  expect(state.rezepte[0].dosierung1).toBe('1-0-1');

  expect(state.labResults).toHaveLength(1);
  expect(state.labResults[0].patient_id).toBe(state.patientId);
  expect(state.labResults[0].bezeichnung).toBe('Hämoglobin');
  expect(state.labResults[0].wert).toBe(14.2);
  expect(state.labResults[0].gruppe).toBe('Hämatologie');
  expect(state.labResults[0].quelle).toBe('Normdatensatz-Import');

  // Labor tab must actually show it, not just write it to an orphan table.
  await page.evaluate((fullName) => {
    document.getElementById('kartei-name').textContent = fullName;
  }, 'Max Mustermann');
  await page.evaluate(() => renderKarteiLabor());
  await page.waitForFunction(() => document.getElementById('labor-liste').textContent.includes('Importierte Laborwerte'));
  const laborHtml = await page.locator('#labor-liste').textContent();
  expect(laborHtml).toContain('Hämoglobin');
  expect(laborHtml).toContain('14.2');
});

test('a diagnosis with an invalid header date is skipped, not written with a wrong date', async ({ page }) => {
  const text =
    ends1Line(1, 'FNM', 'Huber') + ends1Line(1, 'VNM', 'Anna') +
    ends1LineDated(1, 'D', 'TXT', '00000000', '0000', 'Undatierte Altdiagnose');
  await setupAndImport(page, text, []);

  const visits = await page.evaluate(() => window.__store.patient_visits);
  expect(visits).toHaveLength(0);
  const patients = await page.evaluate(() => window.__store.patients);
  expect(patients).toHaveLength(1);
});

test('an ambiguous fixed-width lab value is stored as text, never guessed at as a number', async ({ page }) => {
  const text =
    ends1Line(1, 'FNM', 'Berger') + ends1Line(1, 'VNM', 'Jonas') +
    // An 11-digit fixed-width value per the spec's "8+3 Nachkommastellen"
    // description -- ambiguous without a real sample, must NOT be silently
    // divided/scaled into a guessed number.
    ends1LineDated(1, 'L', 'BEZ', '05012022', '0800', 'Glukose') +
    ends1LineDated(1, 'L', 'WRT', '05012022', '0800', '00000120000');
  await setupAndImport(page, text, []);

  const labResults = await page.evaluate(() => window.__store.patient_lab_results);
  expect(labResults).toHaveLength(1);
  expect(labResults[0].wert).toBeNull();
  expect(labResults[0].ergebnis_text).toContain('00000120000');
});

test('sub-records are written for an already-existing (matched) patient too, referencing the existing patient id', async ({ page }) => {
  const text =
    ends1Line(1, 'FNM', 'Musterfrau') + ends1Line(1, 'VNM', 'Erika') + ends1Line(1, 'VNR', '1234150380') +
    ends1LineDated(1, 'D', 'TXT', '10012020', '1000', 'Hypertonie');
  await setupAndImport(page, text, [
    { id: 'existing-p1', username: 'erika.musterfrau', full_name: 'Erika Musterfrau', name: 'Erika', svnr: '1234150380', dob: '', join_status: 'approved' },
  ]);

  const visits = await page.evaluate(() => window.__store.patient_visits);
  expect(visits).toHaveLength(1);
  expect(visits[0].patient_id).toBe('existing-p1');
  expect(visits[0].diagnose).toBe('Hypertonie');

  const patients = await page.evaluate(() => window.__store.patients);
  expect(patients.filter(p => p.svnr === '1234150380')).toHaveLength(1);
});
