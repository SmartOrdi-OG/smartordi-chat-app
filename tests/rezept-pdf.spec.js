// Regression test for doctor.html's Rezept (prescription) PDF pipeline --
// buildRezeptPdf()/printRezept()/sendRezeptToChat(). This code's own header
// comment records that it used to reference a "currentPatient" variable
// that was never defined anywhere in the file, so every single call threw
// a ReferenceError: the entire Rezept tab was completely non-functional
// until that was fixed. That fix was never covered by a test, so nothing
// would catch a regression bringing the same (or a similar) crash back.
//
// jsPDF itself loads from a CDN (<script src="https://cdnjs.../jspdf...">),
// which this sandbox's network can't reach -- same problem
// tests/helpers/mockSupabase.js already solves for the Supabase CDN
// script, and the same fix applies here: abort that one request so it
// never overwrites our stub regardless of what network the test runs on,
// then inject a minimal window.jspdf stand-in that records what
// buildRezeptPdf() actually drew (text/images) instead of rendering a real
// PDF, so assertions can check the right content ended up on the page.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsPdfMock } = require('./helpers/jspdfStub');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  };
}

async function setupPage(page) {
  await installJsPdfMock(page);
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    await Promise.all([patientsReady, practiceSettingsReady]);
    switchView('clinic');
    toggleKartei();
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    switchKarteiTab('rezept', document.getElementById('ktab-btn-rezept'));
  });
}

test('buildRezeptPdf() refuses to build anything when no patient is selected', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(() => {
    document.getElementById('kartei-name').textContent = 'Kein Patient ausgewählt';
    const doc = buildRezeptPdf();
    return { doc, toastText: document.getElementById('toast')?.textContent || '' };
  });
  expect(result.doc).toBeNull();
  expect(result.toastText).toContain('zuerst einen Patienten auswählen');
});

test('buildRezeptPdf() includes the patient name and both medications, but omits the Rezeptgebührenbefreit banner unless checked', async ({ page }) => {
  await setupPage(page);
  await page.fill('#rz-med1', 'Amoxicillin 500mg');
  await page.fill('#rz-dose1', '3x täglich');
  await page.fill('#rz-med2', 'Ibuprofen 400mg');
  await page.fill('#rz-dose2', '2x täglich');
  const result = await page.evaluate(() => {
    const doc = buildRezeptPdf();
    return { texts: doc._texts, medSummary: doc._rezeptMedSummary, patientName: doc._rezeptPatientName };
  });
  expect(result.patientName).toBe('Maria Huber');
  expect(result.medSummary).toBe('Amoxicillin 500mg, Ibuprofen 400mg');
  expect(result.texts).toContain('Maria Huber');
  expect(result.texts).toContain('Amoxicillin 500mg');
  expect(result.texts).toContain('Ibuprofen 400mg');
  expect(result.texts.join(' ')).not.toContain('REZEPTGEBÜHRENBEFREIT');
});

test('buildRezeptPdf() adds the Rezeptgebührenbefreit banner when checked, and includes free-text notes', async ({ page }) => {
  await setupPage(page);
  await page.fill('#rz-med1', 'Paracetamol 500mg');
  await page.check('#rz-befreit');
  await page.fill('#rz-notes', 'Nach dem Essen einnehmen');
  const result = await page.evaluate(() => buildRezeptPdf()._texts);
  expect(result.join(' ')).toContain('REZEPTGEBÜHRENBEFREIT');
  expect(result).toContain('Nach dem Essen einnehmen');
});

test('sendRezeptToChat() uploads the PDF as a real patient_documents row and sends a chat message referencing it', async ({ page }) => {
  await setupPage(page);
  await page.fill('#rz-med1', 'Amoxicillin 500mg');
  const result = await page.evaluate(async () => {
    await sendRezeptToChat();
    await new Promise(r => setTimeout(r, 100));
    return {
      toastText: document.getElementById('toast')?.textContent || '',
      doc: window.__store.patient_documents[0],
    };
  });
  expect(result.toastText).toContain('Rezept per Chat gesendet');
  expect(result.doc).toBeTruthy();
  expect(result.doc.category).toBe('rezept');
  expect(result.doc.patient_id).toBe('p1');
  expect(result.doc.mime_type).toBe('application/pdf');
  expect(result.doc.uploaded_by).toBe('dr.ahmed');
});

test('sendRezeptToChat() shows a failure toast instead of crashing when the upload fails', async ({ page }) => {
  await setupPage(page);
  await page.fill('#rz-med1', 'Amoxicillin 500mg');
  const result = await page.evaluate(async () => {
    window.__forceError = { patient_documents: 'simulated failure' };
    await sendRezeptToChat();
    return { toastText: document.getElementById('toast')?.textContent || '', rows: window.__store.patient_documents.length };
  });
  expect(result.toastText).toContain('fehlgeschlagen');
  expect(result.rows, 'a failed upload must not leave a document row behind').toBe(0);
});
