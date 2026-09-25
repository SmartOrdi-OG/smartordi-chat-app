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
  await page.evaluate(async (dob) => {
    await patientsReady;
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    updateMkpTabVisibility(dob);
    openKarteiReportModal();
  }, s.patients[0].dob);
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
    document.getElementById('rptDoctorEmailConfirm').value = 'extern@klinik.at';
    updateRptDestUI();
    document.getElementById('rptSendEmail').checked = true;
    let captured = null;
    sb.functions.invoke = async (name, opts) => { captured = { name, opts }; return { data: { ok: true }, error: null }; };
    const messagesBefore = window.__store.patient_messages.length;
    const sendPromise = sendKarteiReport();
    await new Promise(r => setTimeout(r, 50)); // let it reach the confirmation dialog
    resolveReportConfirm(true);
    await sendPromise;
    return { captured, messagesAfter: window.__store.patient_messages.length, messagesBefore };
  });
  expect(result.captured.opts.body.toEmail).toBe('extern@klinik.at');
  expect(result.messagesAfter).toBe(result.messagesBefore);
});

test('MKP section only offered for a pediatric patient, and includes the real completed-exam data in the sent PDF', async ({ page }) => {
  const s = seed();
  // ~2 years old -- within the pediatric window updateMkpTabVisibility() uses.
  s.patients[0].dob = String(new Date().getFullYear() - 2) + '-01-01';
  s.mkp_untersuchungen = [{
    id: 'mkp1', patient_id: 'p1', exam_key: 'lw4_7_allgemein',
    data: { gewicht: 3800, laenge: 55, stillen: 'ja', allgemeinzustand: 'unauffaellig', diagnose: 'Alles unauffällig' },
    completed_at: '2026-01-15T10:00:00Z',
  }];
  await installJsPdfMock(page);
  await installMockSupabase(page, s, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  const result = await page.evaluate(async (dob) => {
    await patientsReady;
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    updateMkpTabVisibility(dob);
    openKarteiReportModal();
    const rowVisible = document.getElementById('rptSecMkpRow').style.display !== 'none';
    document.getElementById('rptSecMkp').checked = true;
    const doc = await buildPatientReportPdf({ mkp: true });
    return { rowVisible, texts: doc._texts };
  }, s.patients[0].dob);
  expect(result.rowVisible, 'MKP row is offered for a pediatric patient').toBe(true);
  const joined = result.texts.join(' | ');
  expect(joined).toContain('Mutter-Kind-Pass');
  expect(joined).toContain('Allgemeine Untersuchung');
  expect(joined).toContain('Körpergewicht (g): 3800');
  expect(joined).toContain('Stillen: Ja');
  expect(joined).toContain('Allgemeinzustand: Unauffällig');
  expect(joined).toContain('Diagnose: Alles unauffällig');
});

test('MKP section is hidden entirely for a patient too old for it', async ({ page }) => {
  await setupPage(page, { dob: '1985-01-01' }); // adult, well past the pediatric window
  const rowVisible = await page.evaluate(() => document.getElementById('rptSecMkpRow').style.display !== 'none');
  expect(rowVisible).toBe(false);
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

// Real production report (2026-09-23, screenshot): sending to an external
// doctor's real e-mail address failed with the generic supabase-js wrapper
// message "Edge Function returned a non-2xx status code" and nothing else --
// send-report-email's own real reason (e.g. Resend rejecting the sandbox
// sender for a non-verified recipient) lives in the response body, reachable
// only via error.context (see extractFunctionErrorDetail()). Same class of
// bug/fix as confirmPlanChange()'s Stripe error handling.
test('a non-2xx response from send-report-email surfaces the real reason from the response body, not the generic wrapper message', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('rptSendChat').checked = false;
    document.getElementById('rptSendEmail').checked = true;
    const fakeResponse = { clone(){ return this; }, json: async () => ({ error: 'resend_failed', detail: { message: 'You can only send testing emails to your own email address' } }) };
    sb.functions.invoke = async () => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: fakeResponse } });
    await sendKarteiReport();
    return { status: document.getElementById('rptStatus').innerHTML };
  });
  expect(result.status).toContain('You can only send testing emails to your own email address');
  expect(result.status).not.toContain('non-2xx');
});

// ═══════════════════════════════════════════════════════════════════════
// Real security gap closed (2026-09-25): a typo in the free-typed external
// doctor's e-mail address used to silently send sensitive health data
// (SVNR, Diagnosen, Anamnese...) to whoever actually owns the mistyped
// address, with no way to catch it before sending. Three mitigations,
// all scoped to the external-doctor destination only -- the patient's own
// on-file address is already trusted, never free-typed here, so none of
// this applies to that path (see the last test below).
// ═══════════════════════════════════════════════════════════════════════

test('Senden is disabled once a mismatched confirmation is typed for the external-doctor e-mail, and re-enabled once it matches', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.querySelector('input[name="rptDest"][value="doctor"]').checked = true;
    updateRptDestUI();
    document.getElementById('rptDoctorEmail').value = 'extern@klinik.at';
    document.getElementById('rptSendEmail').checked = true;
    updateRptDestUI();
    const beforeTyping = document.getElementById('rptSendBtn').disabled;
    document.getElementById('rptDoctorEmailConfirm').value = 'extern@klink.at'; // typo
    updateRptSendBtnState();
    const mismatchDisabled = document.getElementById('rptSendBtn').disabled;
    const mismatchMsgShown = document.getElementById('rptEmailMismatch').style.display !== 'none';
    document.getElementById('rptDoctorEmailConfirm').value = 'extern@klinik.at'; // corrected
    updateRptSendBtnState();
    const matchedDisabled = document.getElementById('rptSendBtn').disabled;
    const matchedMsgShown = document.getElementById('rptEmailMismatch').style.display !== 'none';
    return { beforeTyping, mismatchDisabled, mismatchMsgShown, matchedDisabled, matchedMsgShown };
  });
  expect(result.beforeTyping, 'the button stays disabled until both fields genuinely match -- an empty confirm field does not match a filled one').toBe(true);
  expect(result.mismatchDisabled).toBe(true);
  expect(result.mismatchMsgShown).toBe(true);
  expect(result.matchedDisabled).toBe(false);
  expect(result.matchedMsgShown).toBe(false);
});

test('Senden stays enabled for the external-doctor destination when the e-mail checkbox itself is unchecked (e.g. download-only)', async ({ page }) => {
  await setupPage(page);
  const disabled = await page.evaluate(async () => {
    document.querySelector('input[name="rptDest"][value="doctor"]').checked = true;
    document.getElementById('rptDoctorEmail').value = 'extern@klinik.at';
    document.getElementById('rptDoctorEmailConfirm').value = 'anders@klinik.at'; // mismatched, but irrelevant here
    document.getElementById('rptSendEmail').checked = false;
    document.getElementById('rptSendDownload').checked = true;
    updateRptDestUI();
    return document.getElementById('rptSendBtn').disabled;
  });
  expect(disabled, 'the mismatch only matters when an e-mail is actually about to be sent').toBe(false);
});

test('pasting into the confirmation field is blocked', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(() => {
    document.querySelector('input[name="rptDest"][value="doctor"]').checked = true;
    updateRptDestUI();
  });
  // A synthetic (non-trusted) paste event never actually inserts text via
  // the browser's own default action regardless of preventDefault(), so
  // asserting on the field's VALUE here would pass vacuously either way.
  // What the onpaste handler actually needs to do -- and what this
  // verifies directly -- is call preventDefault() on the event itself;
  // dispatchEvent()'s own return value (false once preventDefault() ran)
  // and the event's defaultPrevented flag are set by that call regardless
  // of whether the browser considers the event trusted.
  const result = await page.evaluate(() => {
    const el = document.getElementById('rptDoctorEmailConfirm');
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    const notCancelled = el.dispatchEvent(event);
    return { notCancelled, defaultPrevented: event.defaultPrevented };
  });
  expect(result.notCancelled, 'dispatchEvent() returns false once preventDefault() has been called').toBe(false);
  expect(result.defaultPrevented).toBe(true);
});

test('the confirmation dialog shows the exact address, and the actual send only happens after "Bestätigen und senden"', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.querySelector('input[name="rptDest"][value="doctor"]').checked = true;
    document.getElementById('rptDoctorEmail').value = 'extern@klinik.at';
    document.getElementById('rptDoctorEmailConfirm').value = 'extern@klinik.at';
    updateRptDestUI();
    document.getElementById('rptSendEmail').checked = true;
    let invokeCalled = false;
    sb.functions.invoke = async (name, opts) => { invokeCalled = true; return { data: { ok: true }, error: null }; };
    const sendPromise = sendKarteiReport();
    await new Promise(r => setTimeout(r, 50));
    const dialogShown = document.getElementById('reportConfirmModal').classList.contains('show');
    const dialogEmail = document.getElementById('reportConfirmEmail').textContent;
    const invokeCalledBeforeConfirm = invokeCalled;
    resolveReportConfirm(true);
    await sendPromise;
    return { dialogShown, dialogEmail, invokeCalledBeforeConfirm, invokeCalledAfterConfirm: invokeCalled };
  });
  expect(result.dialogShown).toBe(true);
  expect(result.dialogEmail).toBe('extern@klinik.at');
  expect(result.invokeCalledBeforeConfirm, 'send-report-email must not be called before the doctor confirms').toBe(false);
  expect(result.invokeCalledAfterConfirm).toBe(true);
});

test('clicking "Abbrechen" on the confirmation dialog cancels the send -- send-report-email is never called', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.querySelector('input[name="rptDest"][value="doctor"]').checked = true;
    document.getElementById('rptDoctorEmail').value = 'extern@klinik.at';
    document.getElementById('rptDoctorEmailConfirm').value = 'extern@klinik.at';
    updateRptDestUI();
    document.getElementById('rptSendEmail').checked = true;
    let invokeCalled = false;
    sb.functions.invoke = async () => { invokeCalled = true; return { data: { ok: true }, error: null }; };
    const sendPromise = sendKarteiReport();
    await new Promise(r => setTimeout(r, 50));
    resolveReportConfirm(false);
    await sendPromise;
    return { invokeCalled, status: document.getElementById('rptStatus').textContent };
  });
  expect(result.invokeCalled).toBe(false);
  expect(result.status).toContain('abgebrochen');
});

test('a successful external-doctor e-mail send is logged with the right patient/recipient/sections', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.querySelector('input[name="rptDest"][value="doctor"]').checked = true;
    document.getElementById('rptDoctorEmail').value = 'extern@klinik.at';
    document.getElementById('rptDoctorEmailConfirm').value = 'extern@klinik.at';
    updateRptDestUI();
    document.getElementById('rptSendEmail').checked = true;
    document.getElementById('rptSecLabor').checked = true;
    sb.functions.invoke = async () => ({ data: { ok: true }, error: null });
    const sendPromise = sendKarteiReport();
    await new Promise(r => setTimeout(r, 50));
    resolveReportConfirm(true);
    await sendPromise;
    return window.__store.patient_report_sends[0];
  });
  expect(result).toBeTruthy();
  expect(result.patient_id).toBe('p1');
  expect(result.sent_to_email).toBe('extern@klinik.at');
  expect(result.destination_type).toBe('doctor');
  expect(result.sections.labor).toBe(true);
  expect(result.sections.stamm).toBe(true);
});

test('a successful patient-e-mail send is logged too, with no confirmation dialog needed', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('rptSendChat').checked = false;
    document.getElementById('rptSendEmail').checked = true;
    sb.functions.invoke = async () => ({ data: { ok: true }, error: null });
    await sendKarteiReport(); // dest stays 'patient' (default) -- no confirm dialog to await
    return window.__store.patient_report_sends[0];
  });
  expect(result).toBeTruthy();
  expect(result.patient_id).toBe('p1');
  expect(result.sent_to_email).toBe('maria@example.at');
  expect(result.destination_type).toBe('patient');
});

test('a failed e-mail send is never logged', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('rptSendChat').checked = false;
    document.getElementById('rptSendEmail').checked = true;
    sb.functions.invoke = async () => ({ data: null, error: { message: 'Resend API down' } });
    await sendKarteiReport();
    return window.__store.patient_report_sends.length;
  });
  expect(result).toBe(0);
});
