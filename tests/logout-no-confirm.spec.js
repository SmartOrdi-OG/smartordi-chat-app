// Regression test for the logout-dialog removal: doLogout()/doctorLogout()
// used to show a native confirm("Wirklich abmelden?") before signing out.
// That was removed on both accounts, but nothing checked in verified it
// stays removed -- a copy-pasted confirm() re-added by a future edit would
// otherwise go unnoticed until a real user hit it in the browser again.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

const CASES = [
  { role: 'secretary', file: 'secretary.html', fn: 'doLogout', user: { role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false } },
  { role: 'doctor', file: 'doctor.html', fn: 'doctorLogout', user: { role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true } },
];

for (const { role, file, fn, user } of CASES) {
  test(`${role}: logging out does not show a confirm dialog and returns to login.html`, async ({ page }) => {
    await installMockSupabase(page, {
      staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
      practice_settings: [{ id: true }],
    });
    await page.addInitScript((u) => { sessionStorage.setItem('smartordi_user', JSON.stringify(u)); }, user);

    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });

    await page.goto('file://' + path.join(__dirname, '..', file));
    await page.waitForTimeout(1000);

    await page.evaluate((f) => { window[f](); }, fn);
    await page.waitForURL(/login\.html$/, { timeout: 5000 });

    expect(dialogs, 'no confirm()/alert() dialog should appear on logout').toEqual([]);
    expect(page.url()).toContain('login.html');
  });
}
