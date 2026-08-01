// Regression test for a real, exploitable stored-XSS class found during a
// full app-wide bug audit (2026-08-01): several HTML-template functions
// build inline onclick="..." handlers by interpolating free text (patient
// full_name, insurance name, uploaded document filenames -- all
// patient/staff-controlled) into a single-quoted JS-string argument that
// itself sits inside a double-quoted HTML attribute. Getting that nesting
// right requires quote-escaping FIRST (for the JS-string context) and THEN
// escapeHtml() (for the HTML-attribute context) -- see the jsArg() helper
// pattern already used elsewhere in these files.
//
// Two distinct bugs were found and fixed:
//  1. doctor.html's impfWarnRowHtml() "Kartei" button interpolated
//     d.patient into the onclick attribute with NO escaping at all -- a
//     literal " in the name breaks out of the HTML attribute entirely.
//  2. dashApptCardHtml()/tuApptRowHtml()/tuApptCardHtml() (doctor.html),
//     secMsgBubbleHtml() (secretary.html), and msgRowHtml() (patient.html)
//     all did escapeHtml(x).replace(/'/g,"\\'") -- the WRONG order.
//     escapeHtml() turns a literal ' into the HTML entity &#39; BEFORE the
//     .replace() ever runs, so the .replace() matches nothing (dead code).
//     This one does NOT break the HTML attribute boundary (escapeHtml still
//     neutralizes a raw " at that level), but the browser's own
//     entity-decode step (attribute value "&#39;" -> literal ' before the
//     onclick handler's JS is compiled) reconstructs a raw, unescaped '
//     that terminates the JS string early once the handler actually runs --
//     so this class only proves out under an actual click, not a static
//     string check on the rendered markup.
//
// Payload closes the JS string early and appends a statement that sets a
// flag IF the reconstructed-quote injection succeeds; clicking the
// rendered element and checking that flag is the only test that exercises
// the real browser HTML-parse -> entity-decode -> JS-eval pipeline both
// bugs actually go through.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

const PAYLOAD = "x');window.__xssFired=true;//";

async function renderAttachClickAndCheck(page, html, selector) {
  return page.evaluate(({ html, selector }) => {
    window.__xssFired = false;
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const el = container.querySelector(selector) || container.firstElementChild;
    el.click();
    const fired = window.__xssFired;
    container.remove();
    return fired;
  }, { html, selector });
}

test.describe('onclick-attribute injection via unescaped patient/document names', () => {
  test('doctor.html: impfWarnRowHtml() Kartei button no longer executes injected JS from an unescaped patient name', async ({ page }) => {
    await installMockSupabase(page, {
      staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    }, () => {
      sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    });
    await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.openKarteiForVaccineCheck = () => {}; }); // stub the real handler so the click is otherwise a no-op
    const html = await page.evaluate((payload) => impfWarnRowHtml({ patient: payload, vaccine: 'MMR', detail: 'Auffrischung', status: 'faellig' }), PAYLOAD);
    const fired = await renderAttachClickAndCheck(page, html, 'button');
    expect(fired, 'clicking the Kartei button must not execute injected JS from the patient name').toBe(false);
  });

  for (const fn of ['dashApptCardHtml', 'tuApptRowHtml', 'tuApptCardHtml']) {
    test(`doctor.html: ${fn}() no longer executes injected JS from an unescaped patient/insurance name`, async ({ page }) => {
      await installMockSupabase(page, {
        staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
      }, () => {
        sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
      });
      await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
      await page.waitForTimeout(1200);
      await page.evaluate(() => { window.openChatForPatient = () => {}; }); // stub the real handler (the card's own onclick)
      const html = await page.evaluate(({ fn, payload }) => window[fn]({
        patient: payload, versicherung: payload, svnr: '123', dob: '1990-01-01',
        art: 'Kontrolle', time: '10:00', status: 'bestaetigt',
      }), { fn, payload: PAYLOAD });
      const fired = await renderAttachClickAndCheck(page, html, '.tu-appt-card, .tu-appt-row');
      expect(fired, `clicking the ${fn}() card must not execute injected JS from patient/versicherung`).toBe(false);
    });
  }

  test('secretary.html: secMsgBubbleHtml() no longer executes injected JS from an unescaped document filename', async ({ page }) => {
    await installMockSupabase(page, {
      staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    }, () => {
      sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    });
    await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.downloadSecDocument = () => {}; }); // stub the real handler
    const html = await page.evaluate((payload) => secMsgBubbleHtml({ type: 'doc', docId: 'd1', filename: payload }), PAYLOAD);
    const fired = await renderAttachClickAndCheck(page, html, '.doc-msg');
    expect(fired, 'clicking the document bubble must not execute injected JS from the filename').toBe(false);
  });

  test('patient.html: msgRowHtml() no longer executes injected JS from an unescaped document filename', async ({ page }) => {
    await installMockSupabase(page, {
      staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
      patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
    }, () => {
      sessionStorage.setItem('smartordi_patient_session', JSON.stringify({ id: 'p1', name: 'Maria', username: 'maria.huber' }));
      localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    });
    await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.downloadPatientDocument = () => {}; }); // stub the real handler
    const html = await page.evaluate((payload) => msgRowHtml({ dir: 'out', type: 'doc', docId: 'd1', filename: payload, time: '10:00' }), PAYLOAD);
    const fired = await renderAttachClickAndCheck(page, html, '[onclick]');
    expect(fired, 'clicking the document bubble must not execute injected JS from the filename').toBe(false);
  });
});
