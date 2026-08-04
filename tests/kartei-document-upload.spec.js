// Regression test for uploadKarteiDocument()/deleteKarteiDocument() in
// doctor.html -- the "Dokumente" tab in a patient's Kartei, which is what a
// patient actually sees in their own Dokumente tab (patient.html) once
// uploaded. Its client-side guardrails (PDF-only, 8 MB cap, title required,
// must have a real Supabase patient identity) and the delete confirmation
// had no test coverage at all.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  };
}

async function setupPage(page) {
  await installMockSupabase(page, seed(), () => {
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

test('rejects a non-PDF file without uploading anything', async ({ page }) => {
  await setupPage(page);
  await page.setInputFiles('#kDokFile', { name: 'scan.png', mimeType: 'image/png', buffer: Buffer.from('not a pdf') });
  await page.fill('#kDokTitel', 'Ein Titel');
  const result = await page.evaluate(async () => {
    await uploadKarteiDocument();
    return { toastText: document.getElementById('toast')?.textContent || '', rows: window.__store.patient_documents.length };
  });
  expect(result.toastText).toContain('Nur PDF-Dateien');
  expect(result.rows).toBe(0);
});

test('rejects a PDF larger than 8 MB without uploading anything', async ({ page }) => {
  await setupPage(page);
  const bigBuffer = Buffer.alloc(8 * 1024 * 1024 + 1);
  await page.setInputFiles('#kDokFile', { name: 'big.pdf', mimeType: 'application/pdf', buffer: bigBuffer });
  await page.fill('#kDokTitel', 'Ein Titel');
  const result = await page.evaluate(async () => {
    await uploadKarteiDocument();
    return { toastText: document.getElementById('toast')?.textContent || '', rows: window.__store.patient_documents.length };
  });
  expect(result.toastText).toContain('zu groß');
  expect(result.rows).toBe(0);
});

test('rejects an upload with no title', async ({ page }) => {
  await setupPage(page);
  await page.setInputFiles('#kDokFile', { name: 'befund.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake') });
  await page.fill('#kDokTitel', '');
  const result = await page.evaluate(async () => {
    await uploadKarteiDocument();
    return { toastText: document.getElementById('toast')?.textContent || '', rows: window.__store.patient_documents.length };
  });
  expect(result.toastText).toContain('Titel eingeben');
  expect(result.rows).toBe(0);
});

test('rejects an upload for a patient without a real Supabase account', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(() => { document.getElementById('kartei-name').textContent = 'Ghost Patient'; });
  await page.setInputFiles('#kDokFile', { name: 'befund.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake') });
  await page.fill('#kDokTitel', 'Ein Titel');
  const result = await page.evaluate(async () => {
    await uploadKarteiDocument();
    return { toastText: document.getElementById('toast')?.textContent || '', rows: window.__store.patient_documents.length };
  });
  expect(result.toastText).toContain('kein Cloud-Konto');
  expect(result.rows).toBe(0);
});

test('uploads a valid PDF with the selected category, title and correct size, attributed to the uploading staff member', async ({ page }) => {
  await setupPage(page);
  await page.selectOption('#kDokKategorie', 'ueberweisung');
  await page.fill('#kDokTitel', 'Überweisung Kardiologie');
  const content = Buffer.from('%PDF-1.4 fake prescription content');
  await page.setInputFiles('#kDokFile', { name: 'ueberweisung.pdf', mimeType: 'application/pdf', buffer: content });
  const result = await page.evaluate(async () => {
    await uploadKarteiDocument();
    await new Promise(r => setTimeout(r, 100));
    return { toastText: document.getElementById('toast')?.textContent || '', doc: window.__store.patient_documents[0] };
  });
  expect(result.toastText).toContain('hochgeladen');
  expect(result.doc.category).toBe('ueberweisung');
  expect(result.doc.title).toBe('Überweisung Kardiologie');
  expect(result.doc.patient_id).toBe('p1');
  expect(result.doc.uploaded_by).toBe('dr.ahmed');
  expect(result.doc.size_bytes).toBe(content.length);
  expect(Buffer.from(result.doc.file_data, 'base64').equals(content)).toBe(true);
});

test('a real server-side rejection (e.g. the phase25 size/MIME-type constraint) shows a failure toast instead of crashing or silently succeeding', async ({ page }) => {
  await setupPage(page);
  await page.selectOption('#kDokKategorie', 'befund');
  await page.fill('#kDokTitel', 'Blutbild');
  await page.setInputFiles('#kDokFile', { name: 'befund.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake') });
  const result = await page.evaluate(async () => {
    window.__forceError = { patient_documents: 'new row for relation "patient_documents" violates check constraint "patient_documents_file_size_limit"' };
    await uploadKarteiDocument();
    await new Promise(r => setTimeout(r, 100));
    return { toastText: document.getElementById('toast')?.textContent || '', rows: window.__store.patient_documents.length };
  });
  expect(result.toastText).toContain('fehlgeschlagen');
  expect(result.rows, 'a rejected insert must not leave a row behind').toBe(0);
});

// deleteKarteiDocument() now asks via showConfirmDialog() -- a custom
// centered modal (#genericConfirmModal) -- instead of window.confirm(),
// since a native confirm() always prepends its own "<origin> says"
// boilerplate and is positioned by the browser itself, not this page (a
// real user screenshot showed it looking cramped/out of place). The modal
// only resolves once a button is actually clicked, so deleteKarteiDocument()
// is deliberately NOT awaited here -- this test drives the click itself,
// the same way a real doctor would.
test('deleteKarteiDocument() asks for confirmation and does nothing if cancelled', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(() => {
    window.__store.patient_documents.push({ id: 'd1', patient_id: 'p1', category: 'befund', title: 'Blutbild', created_at: new Date().toISOString() });
  });
  page.evaluate(() => { deleteKarteiDocument('d1'); });
  await page.waitForSelector('#genericConfirmModal.show');
  const messageText = await page.textContent('#genericConfirmMessage');
  expect(messageText).toBe('Dieses Dokument wirklich löschen?');
  await page.click('#genericConfirmModal .btn-secondary');
  await page.waitForTimeout(100);
  const result = await page.evaluate(() => window.__store.patient_documents.length);
  expect(result, 'cancelling must leave the document in place').toBe(1);
  const modalStillShowing = await page.evaluate(() => document.getElementById('genericConfirmModal').classList.contains('show'));
  expect(modalStillShowing, 'the modal must close after Abbrechen').toBe(false);
});

test('deleteKarteiDocument() removes the document once confirmed', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(() => {
    window.__store.patient_documents.push({ id: 'd1', patient_id: 'p1', category: 'befund', title: 'Blutbild', created_at: new Date().toISOString() });
  });
  page.evaluate(() => { deleteKarteiDocument('d1'); });
  await page.waitForSelector('#genericConfirmModal.show');
  await page.click('#genericConfirmOkBtn');
  await page.waitForTimeout(100);
  const result = await page.evaluate(() => window.__store.patient_documents.length);
  expect(result).toBe(0);
});
