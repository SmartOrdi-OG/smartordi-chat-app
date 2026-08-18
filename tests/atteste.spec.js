// Regression tests for Pflegefreistellung/Arbeitsunfähigkeit document
// generation (supabase/phase51_atteste.sql, vendor/kartei-atteste.js).
// Same structured-storage-alongside-the-generated-PDF pattern as
// tests/structured-rezept-ueberweisung.spec.js, covering both doctor.html's
// own Kartei tabs (under the "Mehr" dropdown) and secretary.html's
// per-patient modal (opened from the chat pane's "Aktionen" menu) -- the
// whole point of vendor/kartei-atteste.js being written the way it is
// (explicit patientName argument, no doctor.html-only globals) is that
// both entry points drive the exact same build/persist functions.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsPdfMock } = require('./helpers/jspdfStub');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro', adresse: 'Hauptstraße 1, 4020 Linz' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', adresse: 'Bahnhofstraße 5, 4020 Linz', join_status: 'approved' }],
  };
}

async function setupDoctorPage(page, tab) {
  await installJsPdfMock(page);
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async (tab) => {
    await Promise.all([patientsReady, practiceSettingsReady, staffRosterReady]);
    switchView('clinic');
    toggleKartei();
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    document.getElementById('kartei-meta').textContent = 'ÖGK · SV 123';
    switchKarteiTab(tab, document.querySelector(`.kartei-tab[onclick*="${tab}"]`));
  }, tab);
}

test('printPflegefreistellung() persists a structured patient_pflegefreistellung row and clears the form afterward', async ({ page }) => {
  await setupDoctorPage(page, 'pflegefreistellung');
  await page.fill('#pf-antragsteller', 'Johann Huber');
  await page.fill('#pf-verwandtschaft', 'Ehepartner');
  await page.fill('#pf-von', '2026-08-10');
  await page.fill('#pf-bis', '2026-08-12');
  await page.fill('#pf-ort', 'Linz');
  const result = await page.evaluate(async () => {
    await printPflegefreistellung();
    await new Promise(r => setTimeout(r, 50));
    return {
      rows: window.__store.patient_pflegefreistellung,
      antragstellerField: document.getElementById('pf-antragsteller').value,
    };
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].patient_id).toBe('p1');
  expect(result.rows[0].antragsteller_name).toBe('Johann Huber');
  expect(result.rows[0].verwandtschaftsverhaeltnis).toBe('Ehepartner');
  expect(result.rows[0].von).toBe('2026-08-10');
  expect(result.rows[0].bis).toBe('2026-08-12');
  expect(result.rows[0].ort).toBe('Linz');
  expect(result.rows[0].document_id, 'printing generates no PDF upload, so no document_id').toBeNull();
  expect(result.rows[0].created_by).toBe('dr.ahmed');
  expect(result.antragstellerField, 'the form must clear after issuing').toBe('');
});

test('downloadPflegefreistellungPdf() persists a structured row too, not just printPflegefreistellung()', async ({ page }) => {
  await setupDoctorPage(page, 'pflegefreistellung');
  await page.fill('#pf-antragsteller', 'Anna Bauer');
  await page.fill('#pf-verwandtschaft', 'Tochter');
  await page.fill('#pf-von', '2026-09-01');
  await page.fill('#pf-bis', '2026-09-03');
  const result = await page.evaluate(async () => {
    await downloadPflegefreistellungPdf();
    await new Promise(r => setTimeout(r, 50));
    return { rows: window.__store.patient_pflegefreistellung };
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].antragsteller_name).toBe('Anna Bauer');
});

test('printArbeitsunfaehigkeit() persists a structured patient_arbeitsunfaehigkeit row, auto-fills patient defaults, and clears the form afterward', async ({ page }) => {
  await setupDoctorPage(page, 'arbeitsunfaehigkeit');
  // Krankenstandsadresse/Versicherungsträger/-nummer are auto-filled from
  // the patient's own record by openAttestTabForCurrentPatient() -- verify
  // that actually happened before issuing.
  const autofill = await page.evaluate(() => ({
    adresse: document.getElementById('au2-adresse').value,
    versTraeger: document.getElementById('au2-versicherungstraeger').value,
    versNummer: document.getElementById('au2-versicherungsnummer').value,
  }));
  expect(autofill.adresse).toBe('Bahnhofstraße 5, 4020 Linz');
  expect(autofill.versTraeger).toBe('ÖGK');
  expect(autofill.versNummer).toBe('123');

  await page.fill('#au2-von', '2026-08-05');
  await page.fill('#au2-bis', '2026-08-09');
  await page.check('#au2-bettruhe');
  const result = await page.evaluate(async () => {
    await printArbeitsunfaehigkeit();
    await new Promise(r => setTimeout(r, 50));
    return {
      rows: window.__store.patient_arbeitsunfaehigkeit,
      adresseField: document.getElementById('au2-adresse').value,
      bettruheField: document.getElementById('au2-bettruhe').checked,
    };
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].patient_id).toBe('p1');
  expect(result.rows[0].von).toBe('2026-08-05');
  expect(result.rows[0].bis).toBe('2026-08-09');
  expect(result.rows[0].bettruhe).toBe(true);
  expect(result.rows[0].versicherungstraeger).toBe('ÖGK');
  expect(result.rows[0].versicherungsnummer).toBe('123');
  expect(result.rows[0].document_id, 'printing generates no PDF upload, so no document_id').toBeNull();
  expect(result.adresseField, 'the form must clear after issuing').toBe('');
  expect(result.bettruheField).toBe(false);
});

test('a failed structured-record insert does not block the real print from succeeding', async ({ page }) => {
  await setupDoctorPage(page, 'arbeitsunfaehigkeit');
  await page.fill('#au2-von', '2026-08-05');
  await page.fill('#au2-bis', '2026-08-09');
  const result = await page.evaluate(async () => {
    window.__forceError = { patient_arbeitsunfaehigkeit: 'simulated failure' };
    await printArbeitsunfaehigkeit();
    await new Promise(r => setTimeout(r, 50));
    return {
      rows: window.__store.patient_arbeitsunfaehigkeit,
      adresseField: document.getElementById('au2-adresse').value,
    };
  });
  expect(result.rows, 'the structured row correctly does not exist given the forced failure').toHaveLength(0);
  expect(result.adresseField, 'the form still clears -- the print itself must not be blocked by the persistence failure').toBe('');
});

// Real user request (2026-08-18): "Per Chat senden" for both Pflegefreistellung
// and Arbeitsunfähigkeit, same as Rezept/Überweisung already have -- doctor.html
// only for now, see sendPflegefreistellungToChat()'s own comment (vendor/
// kartei-atteste.js) for why. Same pattern as tests/rezept-pdf.spec.js's
// sendRezeptToChat() coverage.
test('sendPflegefreistellungToChat() uploads the PDF as a real patient_documents row, persists the structured record with that document_id, and sends a chat message', async ({ page }) => {
  await setupDoctorPage(page, 'pflegefreistellung');
  await page.fill('#pf-antragsteller', 'Johann Huber');
  await page.fill('#pf-verwandtschaft', 'Ehepartner');
  await page.fill('#pf-von', '2026-08-10');
  await page.fill('#pf-bis', '2026-08-12');
  const result = await page.evaluate(async () => {
    await sendPflegefreistellungToChat();
    await new Promise(r => setTimeout(r, 100));
    return {
      toastText: document.getElementById('toast')?.textContent || '',
      doc: window.__store.patient_documents[0],
      row: window.__store.patient_pflegefreistellung[0],
    };
  });
  expect(result.toastText).toContain('Bestätigung per Chat gesendet');
  expect(result.doc).toBeTruthy();
  expect(result.doc.category).toBe('sonstiges');
  expect(result.doc.patient_id).toBe('p1');
  expect(result.doc.mime_type).toBe('application/pdf');
  expect(result.doc.uploaded_by).toBe('dr.ahmed');
  expect(result.row.document_id, 'the structured record must reference the uploaded PDF').toBe(result.doc.id);
});

test('sendPflegefreistellungToChat() shows a failure toast instead of crashing when the upload fails', async ({ page }) => {
  await setupDoctorPage(page, 'pflegefreistellung');
  await page.fill('#pf-von', '2026-08-10');
  await page.fill('#pf-bis', '2026-08-12');
  const result = await page.evaluate(async () => {
    window.__forceError = { patient_documents: 'simulated failure' };
    await sendPflegefreistellungToChat();
    return { toastText: document.getElementById('toast')?.textContent || '', rows: window.__store.patient_documents.length };
  });
  expect(result.toastText).toContain('fehlgeschlagen');
  expect(result.rows, 'a failed upload must not leave a document row behind').toBe(0);
});

test('sendArbeitsunfaehigkeitToChat() uploads the PDF as a real patient_documents row, persists the structured record with that document_id, and sends a chat message', async ({ page }) => {
  await setupDoctorPage(page, 'arbeitsunfaehigkeit');
  await page.fill('#au2-von', '2026-08-05');
  await page.fill('#au2-bis', '2026-08-09');
  const result = await page.evaluate(async () => {
    await sendArbeitsunfaehigkeitToChat();
    await new Promise(r => setTimeout(r, 100));
    return {
      toastText: document.getElementById('toast')?.textContent || '',
      doc: window.__store.patient_documents[0],
      row: window.__store.patient_arbeitsunfaehigkeit[0],
    };
  });
  expect(result.toastText).toContain('Meldung per Chat gesendet');
  expect(result.doc).toBeTruthy();
  expect(result.doc.category).toBe('sonstiges');
  expect(result.doc.patient_id).toBe('p1');
  expect(result.row.document_id, 'the structured record must reference the uploaded PDF').toBe(result.doc.id);
});

// secretary.html has no Kartei-tab system -- Pflegefreistellung/
// Arbeitsunfähigkeit open as a modal for whichever patient's chat is
// currently open instead (the "Aktionen" dropdown in the chat pane
// header). Verifies the same vendor/kartei-atteste.js functions work
// unmodified there too.
async function setupSecretaryPage(page) {
  await installJsPdfMock(page);
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Julia Sekretärin', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    await Promise.all([patientsReady, staffRosterReady]);
    await openChat('Maria Huber', '#0E5E56');
  });
}

test('secretary.html: Arbeitsunfähigkeit modal falls back to the practice\'s doctor for stamp/signature and persists a structured row', async ({ page }) => {
  await setupSecretaryPage(page);
  await page.evaluate(() => openArbeitsunfaehigkeitModalFromChat());
  await expect(page.locator('#arbeitsunfaehigkeitModal')).toHaveClass(/show/);
  await expect(page.locator('#au2-patient-info')).toHaveText(/Maria Huber/);
  await page.fill('#au2-von', '2026-08-05');
  await page.fill('#au2-bis', '2026-08-09');
  const result = await page.evaluate(async () => {
    await secPrintArbeitsunfaehigkeit();
    await new Promise(r => setTimeout(r, 50));
    return { rows: window.__store.patient_arbeitsunfaehigkeit, modalShowing: document.getElementById('arbeitsunfaehigkeitModal').classList.contains('show') };
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].patient_id).toBe('p1');
  // resolveAttestArztInfo() falls back to the practice's own doctor
  // (role==='arzt' in the roster) since a secretary has no staff_profiles
  // row of their own to use.
  expect(result.rows[0].created_by).toBe('sek1');
  expect(result.modalShowing, 'the modal must close after printing').toBe(false);
});
