// Regression test answering a direct question: once a doctor saves their
// signature/stamp in Einstellungen, does it actually show up on the
// documents it's supposed to (Rezept, Überweisung, Patientenbericht)? Each
// of the three PDF builders in doctor.html independently reads the same
// module-level sigDataUrl/stempelDataUrl variables and calls
// doc.addImage(...) with them -- nothing here enforced that all three
// actually do it, so a future edit to any one builder could silently drop
// the signature/stamp from that document without anything catching it.
//
// sigDataUrl/stempelDataUrl are restored on page load from the logged-in
// doctor's own staff_profiles row (sig_data_url/stempel_data_url --
// supabase/phase23_staff_signature_stamp.sql), not re-entered every
// session, so seeding those two columns is enough to exercise the same
// restore path a real returning doctor goes through.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsPdfMock } = require('./helpers/jspdfStub');

const FAKE_SIG = 'data:image/png;base64,ZmFrZS1zaWduYXR1cmU=';
const FAKE_STEMPEL = 'data:image/png;base64,ZmFrZS1zdGVtcGVs';

function seed() {
  return {
    staff_profiles: [{
      id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed',
      role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed',
      sig_data_url: FAKE_SIG, stempel_data_url: FAKE_STEMPEL,
    }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  };
}

async function setupPage(page) {
  await installJsPdfMock(page);
  await installMockSupabase(page, seed(), () => {
    // session.username must equal the staff_profiles row's real id here --
    // in production it's always the Supabase Auth UUID (see login.html's
    // `username:signInData.user.id`), and the sig/stamp restore path below
    // looks the roster up by that same id (loadStaffAccounts()[session.
    // username], keyed by staff_profiles.id). Every other test in this
    // suite uses a human-readable 'dr.ahmed' here purely as an opaque
    // per-test identifier since nothing else they check depends on it
    // matching a real row id -- this one does.
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1500); // window.addEventListener('load', ...) restores sigDataUrl/stempelDataUrl
  await page.evaluate(async () => {
    await patientsReady;
    document.getElementById('kartei-name').textContent = 'Maria Huber';
  });
}

test('a saved signature and stamp are restored into sigDataUrl/stempelDataUrl on page load', async ({ page }) => {
  await setupPage(page);
  const restored = await page.evaluate(() => ({ sigDataUrl, stempelDataUrl }));
  expect(restored.sigDataUrl).toBe(FAKE_SIG);
  expect(restored.stempelDataUrl).toBe(FAKE_STEMPEL);
});

test('the signature and stamp appear on the Rezept PDF', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(() => { switchView('clinic'); toggleKartei(); switchKarteiTab('rezept', document.getElementById('ktab-btn-rezept')); });
  await page.fill('#rz-med1', 'Amoxicillin 500mg');
  const images = await page.evaluate(() => buildRezeptPdf()._images);
  expect(images).toContain(FAKE_SIG);
  expect(images).toContain(FAKE_STEMPEL);
});

test('the signature and stamp appear on the Überweisung PDF', async ({ page }) => {
  await setupPage(page);
  const images = await page.evaluate(() => buildUeberweisungPdf()._images);
  expect(images).toContain(FAKE_SIG);
  expect(images).toContain(FAKE_STEMPEL);
});

test('the signature and stamp appear on the Patientenbericht PDF', async ({ page }) => {
  await setupPage(page);
  const images = await page.evaluate(async () => (await buildPatientReportPdf({}))._images);
  expect(images).toContain(FAKE_SIG);
  expect(images).toContain(FAKE_STEMPEL);
});

test('without a saved signature/stamp, none of the three PDFs draw a broken/empty image', async ({ page }) => {
  await installJsPdfMock(page);
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    await patientsReady;
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    switchView('clinic'); toggleKartei(); switchKarteiTab('rezept', document.getElementById('ktab-btn-rezept'));
  });
  await page.fill('#rz-med1', 'Amoxicillin 500mg');
  const images = await page.evaluate(async () => {
    const rezeptImages = buildRezeptPdf()._images;
    const uwImages = buildUeberweisungPdf()._images;
    const reportImages = (await buildPatientReportPdf({}))._images;
    return { rezeptImages, uwImages, reportImages };
  });
  expect(images.rezeptImages).toEqual([]);
  expect(images.uwImages).toEqual([]);
  expect(images.reportImages).toEqual([]);
});
