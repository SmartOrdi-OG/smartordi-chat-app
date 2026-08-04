// Regression tests for structured Rezept/Überweisung storage
// (supabase/phase38_rezepte_ueberweisungen.sql). Until this, prescriptions
// and referrals existed ONLY as generated PDFs (patient_documents) -- the
// actual medication/referral data lived only in doctor.html's form fields
// at generation time and was never persisted structured, a real gap for
// future ELGA-export readiness (see TODO.md). This verifies the new
// structured rows are actually written -- alongside the existing PDF, not
// instead of it -- on every real "issuing" action (print/download AND
// send-to-chat), and that the form clears afterward.
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

async function setupPage(page, tab) {
  await installJsPdfMock(page);
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async (tab) => {
    await Promise.all([patientsReady, practiceSettingsReady]);
    switchView('clinic');
    toggleKartei();
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    switchKarteiTab(tab, document.getElementById('ktab-btn-' + tab) || document.querySelector(`.kartei-tab[onclick*="${tab}"]`) || document.querySelector('.kartei-tab'));
  }, tab);
}

test('printRezept() persists a structured patient_rezepte row and clears the form afterward', async ({ page }) => {
  await setupPage(page, 'rezept');
  await page.fill('#rz-med1', 'Amoxicillin 500mg');
  await page.fill('#rz-dose1', '3x täglich');
  await page.fill('#rz-pack1', '2');
  await page.fill('#rz-notes', 'Nach dem Essen');
  await page.check('#rz-befreit');
  const result = await page.evaluate(async () => {
    await printRezept();
    await new Promise(r => setTimeout(r, 50));
    return {
      rows: window.__store.patient_rezepte,
      med1Field: document.getElementById('rz-med1').value,
      befreitField: document.getElementById('rz-befreit').checked,
    };
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].patient_id).toBe('p1');
  expect(result.rows[0].med1).toBe('Amoxicillin 500mg');
  expect(result.rows[0].dosierung1).toBe('3x täglich');
  expect(result.rows[0].packungen1).toBe('2');
  expect(result.rows[0].notizen).toBe('Nach dem Essen');
  expect(result.rows[0].rezeptgebuehrenbefreit).toBe(true);
  expect(result.rows[0].document_id, 'printing generates no PDF upload, so no document_id').toBeNull();
  expect(result.rows[0].created_by).toBe('dr.ahmed');
  expect(result.med1Field, 'the form must clear after issuing').toBe('');
  expect(result.befreitField).toBe(false);
});

// Regression for supabase/phase39_rezept_med3_med4.sql: Medikament 3/4
// (revealed via the "+ Medikament hinzufügen" button, addMedikamentSlot() in
// doctor.html) must persist to patient_rezepte's med3/med4 columns just like
// med1/med2 already do, and the form must fully reset (including hiding the
// 3/4 blocks again) after issuing.
test('printRezept() persists Medikament 3 and 4 once revealed and filled in, and hides those blocks again after clearing', async ({ page }) => {
  await setupPage(page, 'rezept');
  await page.click('#rz-add-med-btn');
  await page.click('#rz-add-med-btn');
  await page.fill('#rz-med3', 'Pantoprazol 40mg');
  await page.fill('#rz-dose3', '1x täglich');
  await page.fill('#rz-med4', 'Omeprazol 20mg');
  await page.fill('#rz-pack4', '3');
  const result = await page.evaluate(async () => {
    await printRezept();
    await new Promise(r => setTimeout(r, 50));
    return {
      rows: window.__store.patient_rezepte,
      block3Display: getComputedStyle(document.getElementById('rz-med3-block')).display,
      block4Display: getComputedStyle(document.getElementById('rz-med4-block')).display,
      med3Field: document.getElementById('rz-med3').value,
    };
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].med3).toBe('Pantoprazol 40mg');
  expect(result.rows[0].dosierung3).toBe('1x täglich');
  expect(result.rows[0].med4).toBe('Omeprazol 20mg');
  expect(result.rows[0].packungen4).toBe('3');
  expect(result.block3Display, 'Medikament 3/4 must hide again after issuing, same as they start hidden').toBe('none');
  expect(result.block4Display).toBe('none');
  expect(result.med3Field, 'the form must clear after issuing').toBe('');
});

test('sendRezeptToChat() persists a structured patient_rezepte row linked to the uploaded PDF document', async ({ page }) => {
  await setupPage(page, 'rezept');
  await page.fill('#rz-med1', 'Ibuprofen 400mg');
  const result = await page.evaluate(async () => {
    await sendRezeptToChat();
    await new Promise(r => setTimeout(r, 100));
    return { rows: window.__store.patient_rezepte, docs: window.__store.patient_documents };
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].med1).toBe('Ibuprofen 400mg');
  expect(result.docs).toHaveLength(1);
  expect(result.rows[0].document_id, 'the structured row must link to the real uploaded document').toBe(result.docs[0].id);
});

test('downloadUwPDF() persists a structured patient_ueberweisungen row and clears the form afterward', async ({ page }) => {
  await setupPage(page, 'ueberweisung');
  await page.fill('#uwAn', 'Dr. Klaus Weber – Kardiologie Wien');
  await page.selectOption('#uwFach', 'Kardiologie');
  await page.fill('#uwDiag', 'I10 – Arterielle Hypertonie');
  await page.fill('#uwWegen', 'Kardiologische Abklärung, EKG');
  await page.check('input[name="uwAU"][value="Ja"]');
  const result = await page.evaluate(async () => {
    await downloadUwPDF();
    await new Promise(r => setTimeout(r, 50));
    return {
      rows: window.__store.patient_ueberweisungen,
      anField: document.getElementById('uwAn').value,
      auChecked: document.querySelector('input[name="uwAU"][value="Ja"]').checked,
    };
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].patient_id).toBe('p1');
  expect(result.rows[0].an).toBe('Dr. Klaus Weber – Kardiologie Wien');
  expect(result.rows[0].fachrichtung).toBe('Kardiologie');
  expect(result.rows[0].diagnose).toBe('I10 – Arterielle Hypertonie');
  expect(result.rows[0].wegen).toBe('Kardiologische Abklärung, EKG');
  expect(result.rows[0].arbeitsunfaehig).toBe(true);
  expect(result.rows[0].document_id, 'downloading generates no PDF upload, so no document_id').toBeNull();
  expect(result.anField, 'the form must clear after issuing').toBe('');
  expect(result.auChecked, 'the Arbeitsunfähig radio must reset to Nein').toBe(false);
});

// The preview modal used to offer only a PDF download -- printUwPDF() adds
// a real "Drucken" path (same openPdfAndPrint() hidden-iframe pattern as
// printRezept()) for a patient still in the Ordination.
test('printUwPDF() persists a structured patient_ueberweisungen row and clears the form afterward', async ({ page }) => {
  await setupPage(page, 'ueberweisung');
  await page.fill('#uwAn', 'Dr. Klaus Weber – Kardiologie Wien');
  await page.selectOption('#uwFach', 'Kardiologie');
  await page.fill('#uwDiag', 'I10 – Arterielle Hypertonie');
  await page.fill('#uwWegen', 'Kardiologische Abklärung, EKG');
  await page.check('input[name="uwAU"][value="Ja"]');
  const result = await page.evaluate(async () => {
    await printUwPDF();
    await new Promise(r => setTimeout(r, 50));
    return {
      rows: window.__store.patient_ueberweisungen,
      anField: document.getElementById('uwAn').value,
      auChecked: document.querySelector('input[name="uwAU"][value="Ja"]').checked,
    };
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].patient_id).toBe('p1');
  expect(result.rows[0].an).toBe('Dr. Klaus Weber – Kardiologie Wien');
  expect(result.rows[0].document_id, 'printing generates no PDF upload, so no document_id').toBeNull();
  expect(result.anField, 'the form must clear after issuing').toBe('');
  expect(result.auChecked, 'the Arbeitsunfähig radio must reset to Nein').toBe(false);
});

test('handleUwSend() (Per Chat senden) persists a structured patient_ueberweisungen row linked to the uploaded PDF document', async ({ page }) => {
  await setupPage(page, 'ueberweisung');
  await page.fill('#uwAn', 'Dr. Eva Novak – Neurologie Graz');
  await page.selectOption('#uwFach', 'Neurologie');
  const result = await page.evaluate(async () => {
    await handleUwSend();
    await new Promise(r => setTimeout(r, 100));
    return { rows: window.__store.patient_ueberweisungen, docs: window.__store.patient_documents };
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].an).toBe('Dr. Eva Novak – Neurologie Graz');
  expect(result.rows[0].fachrichtung).toBe('Neurologie');
  expect(result.docs).toHaveLength(1);
  expect(result.rows[0].document_id, 'the structured row must link to the real uploaded document').toBe(result.docs[0].id);
});

test('a failed structured-record insert does not block the real Rezept chat-send from succeeding', async ({ page }) => {
  await setupPage(page, 'rezept');
  await page.fill('#rz-med1', 'Paracetamol 500mg');
  const result = await page.evaluate(async () => {
    window.__forceError = { patient_rezepte: 'simulated failure' };
    await sendRezeptToChat();
    await new Promise(r => setTimeout(r, 100));
    return {
      toastText: document.getElementById('toast')?.textContent || '',
      docs: window.__store.patient_documents,
      rezepte: window.__store.patient_rezepte,
    };
  });
  expect(result.toastText, 'the real send must still report success even though the structured-record insert failed').toContain('gesendet');
  expect(result.docs, 'the actual PDF document must still have been uploaded').toHaveLength(1);
  expect(result.rezepte, 'the structured row correctly does not exist given the forced failure').toHaveLength(0);
});
