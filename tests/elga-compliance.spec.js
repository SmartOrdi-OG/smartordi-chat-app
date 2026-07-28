// Regression tests for the e-card/ELGA 2026 compliance follow-up items
// (see TODO.md, PR #354's follow-up list): an in-app reminder card about the
// legal e-card/e-Wahlpartner requirement, a rough patient-count indicator
// for the ~300/year proportionality exemption, and a structured JSON export
// (DSGVO Art. 20 data portability + future ELGA-export readiness) alongside
// the existing CSV export.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsPdfMock } = require('./helpers/jspdfStub');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
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
}

test('the e-card/ELGA reminder card shows the official portal link', async ({ page }) => {
  await setupPage(page, { patients: [] });
  await page.evaluate(() => { switchView('settings'); });
  await expect(page.locator('a[href="https://www.gesundheit.gv.at/e-card"]')).toBeVisible();
  await expect(page.locator('#elgaPatientCount')).toHaveText('0');
});

test('updateElgaPatientCount() counts distinct patients with a completed Termin in the last 365 days, excluding future/incomplete/old ones', async ({ page }) => {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };
  const daysAhead = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };

  await setupPage(page, {
    patients: [
      { id: 'p1', username: 'p1', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' },
      { id: 'p2', username: 'p2', full_name: 'Josef Bauer', name: 'Josef', join_status: 'approved' },
      { id: 'p3', username: 'p3', full_name: 'Anna Fischer', name: 'Anna', join_status: 'approved' },
      { id: 'p4', username: 'p4', full_name: 'Elena Roth', name: 'Elena', join_status: 'approved' },
    ],
    termine: [
      // p1: completed 30 days ago -- counts.
      { id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', date: daysAgo(30), time: '09:00', status: 'bestaetigt', completed_at: daysAgo(30) + 'T09:00:00' },
      // p1 again, a second completed visit -- must not double-count the same patient.
      { id: 't2', patient_id: 'p1', patient_name: 'Maria Huber', date: daysAgo(10), time: '09:00', status: 'bestaetigt', completed_at: daysAgo(10) + 'T09:00:00' },
      // p2: completed 400 days ago -- outside the 365-day window, must not count.
      { id: 't3', patient_id: 'p2', patient_name: 'Josef Bauer', date: daysAgo(400), time: '09:00', status: 'bestaetigt', completed_at: daysAgo(400) + 'T09:00:00' },
      // p3: booked in the future, not completed yet -- must not count.
      { id: 't4', patient_id: 'p3', patient_name: 'Anna Fischer', date: daysAhead(5), time: '09:00', status: 'bestaetigt', completed_at: null },
      // p4: recent but never marked completed (e.g. no-show) -- must not count.
      { id: 't5', patient_id: 'p4', patient_name: 'Elena Roth', date: daysAgo(5), time: '09:00', status: 'bestaetigt', completed_at: null },
    ],
  });
  const count = await page.evaluate(async () => {
    await termineReady;
    updateElgaPatientCount();
    return document.getElementById('elgaPatientCount').textContent;
  });
  expect(count).toBe('1');
});

test('exportPatientJson() produces a complete, correctly-structured export including Anamnese, Impfungen and Behandlungsverlauf', async ({ page }) => {
  await setupPage(page, {
    patients: [{
      id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria',
      versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', tel: '+43 660 111', email: 'maria@example.at',
      adresse: 'Hauptstraße 1, 4020 Linz', diagnosen: 'Migräne', allergie: 'Penizillin', blutgruppe: 'A+',
      anamnese: { 'common.raucher': 'nein', 'common.allergie.penizillin': true },
      join_status: 'approved',
    }],
    patient_impfungen: [{ id: 'i1', patient_id: 'p1', vaccine_key: 'fsme', vaccine_name: 'FSME', datum: '2024-03-15', next_due: null }],
    patient_visits: [{ id: 'v1', patient_id: 'p1', visit_date: '2026-05-10', visit_type: 'Kontrolle', beschwerde: 'Husten', temperature: '37.8°C', blutdruck: '120/80', schmerz: '2', diagnose: 'J06.9', notes: 'Beobachtung', therapy: 'Ruhe', created_at: new Date().toISOString() }],
    termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', date: '2026-06-01', time: '10:00', end_time: '10:30', art: 'Kontrolle', status: 'bestaetigt', completed_at: '2026-06-01T10:00:00' }],
  });

  const data = await page.evaluate(async () => {
    await Promise.all([patientsReady, impfungenReady, termineReady]);
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    let captured;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (blob) => { captured = blob; return 'blob:stub'; };
    const origRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = () => {};
    await exportPatientJson();
    URL.createObjectURL = orig;
    URL.revokeObjectURL = origRevoke;
    return JSON.parse(await captured.text());
  });

  expect(data.stammdaten.vorname).toBe('Maria');
  expect(data.stammdaten.nachname).toBe('Huber');
  expect(data.stammdaten.svnr).toBe('123');
  expect(data.stammdaten.adresse).toBe('Hauptstraße 1, 4020 Linz');
  expect(data.diagnosen).toBe('Migräne');
  expect(data.allergien).toBe('Penizillin');
  expect(data.blutgruppe).toBe('A+');
  expect(data.anamnese).toEqual({ 'common.raucher': 'nein', 'common.allergie.penizillin': true });
  expect(data.impfungen).toHaveLength(1);
  expect(data.impfungen[0].name).toBe('FSME');
  expect(data.impfungen[0].datum).toBe('2024-03-15');
  expect(data.behandlungsverlauf).toHaveLength(1);
  expect(data.behandlungsverlauf[0].diagnose).toBe('J06.9');
  expect(data.behandlungsverlauf[0].therapie).toBe('Ruhe');
  expect(data.termine).toHaveLength(1);
  expect(data.termine[0].datum).toBe('2026-06-01');
  expect(data.termine[0].abgeschlossen).toBe(true);
});

test('exportPatientJson() refuses when no patient is selected', async ({ page }) => {
  await setupPage(page, { patients: [] });
  const toastText = await page.evaluate(async () => {
    document.getElementById('kartei-name').textContent = 'Kein Patient ausgewählt';
    await exportPatientJson();
    await new Promise((r) => setTimeout(r, 50));
    return document.getElementById('toast')?.textContent;
  });
  expect(toastText).toContain('Bitte zuerst einen Patienten auswählen');
});
