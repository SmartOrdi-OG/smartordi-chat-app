// Regression test for doctor.html's "Bericht senden" modal (sendKarteiReport()/
// openKarteiReportModal()/updateRptDestUI()) -- lets a doctor send a
// Patientenbericht PDF to the patient (via chat and/or e-mail) or to an
// external doctor (via e-mail only), with any combination of the three
// channels (chat/e-mail/download). None of this had any test coverage at
// all before, despite real validation logic (refusing empty content/empty
// send-method) and a real external e-mail integration (send-report-email).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsPdfMock } = require('./helpers/jspdfStub');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', email: 'maria@example.at', join_status: 'approved' }],
  };
}

async function setupPage(page, patientOverrides) {
  await installJsPdfMock(page);
  const s = seed();
  if (patientOverrides) Object.assign(s.patients[0], patientOverrides);
  await installMockSupabase(page, s, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    await patientsReady;
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    openKarteiReportModal();
  });
}

test('refuses to send when no content section is selected', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('rptSecStamm').checked = false;
    document.getElementById('rptSecVerlauf').checked = false;
    document.getElementById('rptSecDiagnosen').checked = false;
    await sendKarteiReport();
    return {
      toast: document.getElementById('toast')?.textContent || '',
      modalStillOpen: document.getElementById('karteiReportModal').classList.contains('show'),
      docsCount: window.__store.patient_documents.length,
      messagesCount: window.__store.patient_messages.length,
    };
  });
  expect(result.toast).toContain('mindestens einen Inhalt');
  expect(result.modalStillOpen).toBe(true);
  expect(result.docsCount).toBe(0);
  expect(result.messagesCount).toBe(0);
});

test('refuses to send when no send method is selected', async ({ page }) => {
  await setupPage(page);
  const toast = await page.evaluate(async () => {
    document.getElementById('rptSendChat').checked = false;
    document.getElementById('rptSendEmail').checked = false;
    document.getElementById('rptSendDownload').checked = false;
    await sendKarteiReport();
    return document.getElementById('toast')?.textContent || '';
  });
  expect(toast).toContain('mindestens eine Versandart');
});

test('sends the report to the patient via chat: uploads a real document and a chat message, then closes the modal', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    // Defaults from openKarteiReportModal(): Stamm/Verlauf/Diagnosen checked, dest=patient, Chat checked.
    await sendKarteiReport();
    return {
      toast: document.getElementById('toast')?.textContent || '',
      modalOpen: document.getElementById('karteiReportModal').classList.contains('show'),
      doc: window.__store.patient_documents[0],
      msg: window.__store.patient_messages[window.__store.patient_messages.length - 1],
    };
  });
  expect(result.toast).toContain('Bericht gesendet');
  expect(result.modalOpen).toBe(false);
  expect(result.doc.title).toBe('Patientenbericht');
  expect(result.doc.mime_type).toBe('application/pdf');
  expect(result.msg.type).toBe('doc');
  expect(result.msg.filename).toContain('Patientenbericht_Maria_Huber');
});

test('sends the report to the patient via e-mail, using the patient\'s own on-file address', async ({ page }) => {
  await setupPage(page);
  const invokeArgs = await page.evaluate(async () => {
    document.getElementById('rptSendChat').checked = false;
    document.getElementById('rptSendEmail').checked = true;
    let captured = null;
    sb.functions.invoke = async (name, opts) => { captured = { name, opts }; return { data: { ok: true }, error: null }; };
    await sendKarteiReport();
    return { captured, toast: document.getElementById('toast')?.textContent || '' };
  });
  expect(invokeArgs.captured.name).toBe('send-report-email');
  expect(invokeArgs.captured.opts.body.toEmail).toBe('maria@example.at');
  expect(invokeArgs.toast).toContain('Bericht gesendet');
});

test('reports a clean failure instead of crashing when the patient has no e-mail on file', async ({ page }) => {
  await setupPage(page, { email: '' });
  const result = await page.evaluate(async () => {
    document.getElementById('rptSendChat').checked = false;
    document.getElementById('rptSendEmail').checked = true;
    await sendKarteiReport();
    return {
      status: document.getElementById('rptStatus').textContent,
      modalOpen: document.getElementById('karteiReportModal').classList.contains('show'),
    };
  });
  expect(result.status).toContain('Keine E-Mail-Adresse angegeben');
  // A failed send must not silently close the modal as if it succeeded.
  expect(result.modalOpen).toBe(true);
});

test('sends to an external doctor\'s typed e-mail address instead of the patient\'s, and never sends a chat message for that destination', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.querySelector('input[name="rptDest"][value="doctor"]').checked = true;
    document.getElementById('rptDoctorName').value = 'Dr. Extern';
    document.getElementById('rptDoctorEmail').value = 'extern@klinik.at';
    updateRptDestUI();
    document.getElementById('rptSendEmail').checked = true;
    let captured = null;
    sb.functions.invoke = async (name, opts) => { captured = { name, opts }; return { data: { ok: true }, error: null }; };
    const messagesBefore = window.__store.patient_messages.length;
    await sendKarteiReport();
    return { captured, messagesAfter: window.__store.patient_messages.length, messagesBefore };
  });
  expect(result.captured.opts.body.toEmail).toBe('extern@klinik.at');
  expect(result.messagesAfter).toBe(result.messagesBefore);
});

test('partial success (chat sent, e-mail failed) is reported as partial and leaves the modal open', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('rptSendChat').checked = true;
    document.getElementById('rptSendEmail').checked = true;
    sb.functions.invoke = async () => ({ data: null, error: { message: 'Resend API down' } });
    await sendKarteiReport();
    return {
      toast: document.getElementById('toast')?.textContent || '',
      status: document.getElementById('rptStatus').innerHTML,
      modalOpen: document.getElementById('karteiReportModal').classList.contains('show'),
      docsCount: window.__store.patient_documents.length,
    };
  });
  expect(result.toast).toContain('Teilweise gesendet');
  expect(result.status).toContain('E-Mail-Versand fehlgeschlagen');
  expect(result.status).toContain('Resend API down');
  expect(result.modalOpen).toBe(true);
  // The chat send must have gone through independently of the e-mail failure.
  expect(result.docsCount).toBe(1);
});
