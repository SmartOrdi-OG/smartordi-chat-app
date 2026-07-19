// Regression test for the XSS audit fix (patient name/message/diagnosen
// text is rendered via innerHTML template literals throughout doctor.html
// and secretary.html, so every such value must go through escapeHtml()).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

const XSS_NAME = 'Evil<img src=x onerror=window.__xssFired=true>Patient';
const XSS_MSG = 'hello<script>window.__xssFired=true</script>';
const XSS_DIAG = 'Migräne<img src=x onerror=window.__xssFired=true>,Foo';

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true, adresse: 'Steingasse 6A, 4020 Linz', tel: '+43 677 62439293', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'evilpatient', full_name: XSS_NAME, name: 'Evil', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', diagnosen: XSS_DIAG, allergie: 'Penicillin', join_status: 'approved' }],
    patient_messages: [{ id: 'm1', patient_id: 'p1', dir: 'in', type: 'text', text: XSS_MSG, created_at: new Date().toISOString() }],
  };
}

async function setupPage(page, htmlFile) {
  await installMockSupabase(page, seed(), () => {
    window.__xssFired = false;
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto('file://' + path.join(__dirname, '..', htmlFile));
  await page.waitForTimeout(1200);
  return dialogs;
}

for (const [role, file] of [['secretary', 'secretary.html'], ['doctor', 'doctor.html']]) {
  test(`${role}: XSS payloads in patient name/message/diagnosen are escaped, not executed`, async ({ page }) => {
    const dialogs = await setupPage(page, file);

    const result = await page.evaluate(async () => {
      if (typeof renderRealPatientRows === 'function') { await Promise.all([patientsReady, allMessagesReady]); renderRealPatientRows(); }
      if (typeof renderPatientList === 'function') { await Promise.all([patientsReady, allMessagesReady]); renderPatientList(); }
      if (typeof updatePatientPanel === 'function') {
        try { updatePatientPanel('Evil<img src=x onerror=window.__xssFired=true>Patient'); } catch (e) {}
      }
      await new Promise(r => setTimeout(r, 300));
      return {
        xssFired: window.__xssFired,
        hasImgTagLiteral: document.body.innerHTML.includes('&lt;img'),
        hasRawImgTag: /<img[^>]*onerror/.test(document.body.innerHTML),
      };
    });

    expect(dialogs, 'no alert() dialog should ever fire from an XSS payload').toEqual([]);
    expect(result.xssFired, 'payload must never execute').toBe(false);
    expect(result.hasRawImgTag, 'no raw executable <img onerror> tag may reach the DOM').toBe(false);
  });
}
