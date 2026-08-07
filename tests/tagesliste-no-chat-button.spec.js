// Request: remove the "Chat" button from doctor.html's "Tagesliste" modal
// (Dashboard's "Alle sehen →" link, openAlleTermineModal()/renderAlleTermine()
// -> allTerminRowHtml()) -- "احذفلي الشات من هاي القايمة مافي داعي الها"
// (remove Chat from this list, it's not needed there). "Kartei" stays; the
// doctor can still jump straight to the patient's chart from this list, just
// not open the chat conversation from here.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function ymd(d) { return d.toISOString().slice(0, 10); }

async function setupPage(page) {
  const today = new Date();
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'maria', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
    termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: ymd(today), time: '11:00', end_time: '11:45', status: 'bestaetigt', arzt_id: 'u1' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, termineReady]); });
}

test('the Tagesliste modal shows a "Kartei" button per row but no "Chat" button', async ({ page }) => {
  await setupPage(page);
  const html = await page.evaluate(() => {
    openAlleTermineModal();
    return document.getElementById('allTermineRoot').innerHTML;
  });
  expect(html).toContain('Kartei');
  expect(html).not.toContain('>Chat<');
});
