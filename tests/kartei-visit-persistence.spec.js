// Regression test for a real, serious bug found while looking for
// untested Kartei areas: the "Verlauf" tab (Neue Behandlung -- date/type/
// complaint/vitals/diagnosis/notes/therapy) stored every entry in a plain
// in-memory JS array (`const VISITS = []`) with NO table behind it at
// all. A doctor's entire visit-history documentation for every patient
// was silently lost on every page reload, and never appeared on another
// device/browser. Fixed via supabase/phase27_patient_visits.sql +
// createPatientVisit()/getVisitsForPatient() (vendor/patient-data.js) +
// loadKarteiVisits()/saveKarteiVisit() (doctor.html), which also fixed a
// second bug this same investigation turned up: buildPatientReportPdf()/
// exportPatientCsv() only ever saw whichever patient's Verlauf tab had
// last been opened in THIS session, so generating a report without first
// opening that tab silently omitted real visit history that existed on
// the server.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsPdfMock } = require('./helpers/jspdfStub');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  }, extra);
}

async function setupPage(page, extraSeed) {
  await installJsPdfMock(page);
  await installMockSupabase(page, seed(extraSeed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    await patientsReady;
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    switchView('clinic'); toggleKartei();
  });
}

test('a previously-saved visit (as if from an earlier session) shows up when opening the Verlauf tab -- proves the read path is real, not session-local', async ({ page }) => {
  await setupPage(page, {
    patient_visits: [{ id: 'v1', patient_id: 'p1', visit_date: '2026-05-10', visit_type: 'Kontrolle', beschwerde: 'Husten', temperature: '37.8°C', blutdruck: '120/80', schmerz: '2', diagnose: 'J06.9 – Akute Infektion', notes: 'Beobachtung', therapy: 'Ruhe', created_at: new Date().toISOString() }],
  });
  const visible = await page.evaluate(async () => {
    switchKarteiTab('verlauf', document.querySelector('.kartei-tab'));
    await new Promise(r => setTimeout(r, 50)); // loadKarteiVisits() is fire-and-forget from switchKarteiTab
    return document.getElementById('kVisitList').innerHTML;
  });
  expect(visible).toContain('J06.9');
  expect(visible).toContain('Husten');
});

test('saveKarteiVisit() writes a real row to patient_visits, not just a local-only array', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    switchKarteiTab('verlauf', document.querySelector('.kartei-tab'));
    document.getElementById('kDate').value = '2026-07-20';
    document.getElementById('kType').value = 'Ordination';
    document.getElementById('kDiag').value = 'Migräne';
    document.getElementById('kNotes').value = 'Patient klagt über Kopfschmerzen';
    await saveKarteiVisit();
    return {
      rows: window.__store.patient_visits,
      toast: document.getElementById('toast')?.textContent || '',
    };
  });
  expect(result.rows.length).toBe(1);
  expect(result.rows[0].patient_id).toBe('p1');
  expect(result.rows[0].diagnose).toBe('Migräne');
  expect(result.rows[0].created_by).toBe('dr.ahmed');
});

test('refuses to save without a date, and writes no row', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    switchKarteiTab('verlauf', document.querySelector('.kartei-tab'));
    document.getElementById('kDate').value = '';
    document.getElementById('kDiag').value = 'Migräne';
    await saveKarteiVisit();
    return { rows: window.__store.patient_visits.length, toast: document.getElementById('toast')?.textContent || '' };
  });
  expect(result.rows).toBe(0);
  expect(result.toast).toContain('Datum');
});

test('refuses to save for a patient without a real Supabase account', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('kartei-name').textContent = 'Ghost Patient';
    switchKarteiTab('verlauf', document.querySelector('.kartei-tab'));
    document.getElementById('kDate').value = '2026-07-20';
    await saveKarteiVisit();
    return { rows: window.__store.patient_visits.length, toast: document.getElementById('toast')?.textContent || '' };
  });
  expect(result.rows).toBe(0);
  expect(result.toast).toContain('Cloud-Konto');
});

test('buildPatientReportPdf() includes real visit history even if the Verlauf tab was never opened first', async ({ page }) => {
  await setupPage(page, {
    patient_visits: [{ id: 'v1', patient_id: 'p1', visit_date: '2026-05-10', visit_type: 'Kontrolle', diagnose: 'J06.9 – Akute Infektion', created_at: new Date().toISOString() }],
  });
  const texts = await page.evaluate(async () => {
    // Deliberately switch to a different tab (never 'verlauf') before building the report.
    switchKarteiTab('rezept', document.getElementById('ktab-btn-rezept'));
    const doc = await buildPatientReportPdf({ verlauf: true });
    return doc._texts.join(' | ');
  });
  expect(texts).toContain('J06.9');
});
