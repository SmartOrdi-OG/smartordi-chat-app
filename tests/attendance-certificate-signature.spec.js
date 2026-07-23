// Regression test for secretary.html's Anwesenheitsbestätigung (proof-of-
// attendance certificate a patient hands to their employer/school/insurer
// after a visit) -- its "Unterschrift / Stempel" line used to be nothing
// but a static text label, never actually carrying the treating doctor's
// real saved signature/stamp the way doctor.html's own Rezept/Überweisung/
// Patientenbericht PDFs already do (see tests/signature-stamp-in-pdfs.spec.js).
// Since this document is issued on behalf of whichever doctor treated the
// patient (not necessarily the secretary logged in right now, who has no
// signature of their own at all), the correct source is that SPECIFIC
// doctor's own staff_profiles row, looked up by the termin's arztUsername.
//
// printAnwesenheitsbestaetigung() opens a real browser window and calls
// document.write()/print() on it -- neither of which this suite can (or
// should) exercise directly, so window.open is overridden to capture the
// written HTML string instead, the same technique used throughout this
// project for anything that would otherwise pop a real window/dialog.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

const FAKE_SIG = 'data:image/png;base64,ZmFrZS1zaWduYXR1cmU=';
const FAKE_STEMPEL = 'data:image/png;base64,ZmFrZS1zdGVtcGVs';

function seed(withSignature) {
  return {
    staff_profiles: [
      { id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' },
      Object.assign(
        { id: 'u2', vorname: 'Jonas', nachname: 'Berger', full_name: 'Dr. Jonas Berger', role: 'arzt', fach: 'Kardiologie', is_admin: false, email: 'j@a.at', username: 'dr.berger' },
        withSignature ? { sig_data_url: FAKE_SIG, stempel_data_url: FAKE_STEMPEL } : {},
      ),
    ],
    practices: [{ id: 'prac1', name: 'Musterordination', adresse: 'Steingasse 6A, 4020 Linz', tel: '+43 677 62439293' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  };
}

async function setupPage(page, withSignature) {
  await page.addInitScript(() => {
    window.__lastPrintHtml = null;
    window.open = () => ({
      document: { write(html) { window.__lastPrintHtml = html; }, close() {} },
      focus() {}, print() {},
    });
  });
  await installMockSupabase(page, seed(withSignature), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({
      'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' },
      'dr.berger': { username: 'dr.berger', fullName: 'Dr. Jonas Berger', role: 'arzt', isAdmin: false, fach: 'Kardiologie' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await staffRosterReady; });
}

test('the treating doctor\'s real saved signature and stamp appear on the Anwesenheitsbestätigung', async ({ page }) => {
  await setupPage(page, true);
  const html = await page.evaluate(() => {
    printAnwesenheitsbestaetigung('Maria Huber', '2026-08-15', '09:00', '09:30', 'Kontrolle', 'u2');
    return window.__lastPrintHtml;
  });
  expect(html).toContain(FAKE_SIG);
  expect(html).toContain(FAKE_STEMPEL);
  expect(html).toContain('Dr. Jonas Berger');
});

test('without a saved signature/stamp, the certificate still shows the plain label and no broken image', async ({ page }) => {
  await setupPage(page, false);
  const html = await page.evaluate(() => {
    printAnwesenheitsbestaetigung('Maria Huber', '2026-08-15', '09:00', '09:30', 'Kontrolle', 'u2');
    return window.__lastPrintHtml;
  });
  // The document header always has its own <img> (the Smartordi logo) --
  // check the sig-line specifically stayed untouched (no image spliced in),
  // not just "no <img> anywhere in the whole page".
  expect(html).toContain('<div class="sig-line">Unterschrift / Stempel</div>');
});

test('a different doctor\'s signature is never shown for a termin treated by someone else', async ({ page }) => {
  await setupPage(page, true); // only u2 (Dr. Berger) has a saved signature
  const html = await page.evaluate(() => {
    printAnwesenheitsbestaetigung('Maria Huber', '2026-08-15', '09:00', '09:30', 'Kontrolle', 'u1');
    return window.__lastPrintHtml;
  });
  expect(html, 'Dr. Ahmed (u1) has no saved signature of her own -- Dr. Berger\'s must never appear on her patient\'s certificate').not.toContain(FAKE_SIG);
  expect(html).not.toContain(FAKE_STEMPEL);
  expect(html).toContain('Dr. Sarah Ahmed');
});
