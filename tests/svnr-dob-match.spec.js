// Regression test for a real user request: warn when the Austrian
// Sozialversicherungsnummer's embedded birth date (its last 6 digits,
// TTMMJJ/DDMMYY) doesn't match the separately-entered Geburtsdatum field --
// a common data-entry error (a typo in either field). svnrMatchesDob()/
// checkSvnrDobWarning() live in vendor/staff-accounts.js, wired into
// secretary.html's "+ Neuer Patient" and "Patient bearbeiten" forms and
// patient-login.html's self-registration form.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test.describe('svnrMatchesDob() (pure function)', () => {
  async function setup(page) {
    await installMockSupabase(page, {}, () => {
      sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
      localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    });
    await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
    await page.waitForTimeout(1200);
  }

  test('returns true when the SVNr\'s embedded date matches the DOB', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => svnrMatchesDob('1234 010190', '1990-01-01'));
    expect(result).toBe(true);
  });

  test('returns false on a genuine mismatch', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => svnrMatchesDob('1234 020190', '1990-01-01'));
    expect(result).toBe(false);
  });

  test('tolerates the SVNr with or without its usual space', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => svnrMatchesDob('1234010190', '1990-01-01'));
    expect(result).toBe(true);
  });

  test('returns null (nothing to check yet) when the SVNr is incomplete', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => svnrMatchesDob('1234 0101', '1990-01-01'));
    expect(result).toBeNull();
  });

  test('returns null when the DOB is empty', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => svnrMatchesDob('1234 010190', ''));
    expect(result).toBeNull();
  });

  test('handles a birth year ending in a two-digit rollover correctly (2005, not 1905)', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(() => svnrMatchesDob('1234 150605', '2005-06-15'));
    expect(result).toBe(true);
  });
});

test.describe('checkSvnrDobWarning() UI wiring', () => {
  function seed() {
    return {
      staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    };
  }

  test('secretary.html "+ Neuer Patient": the warning shows on a mismatch and hides once fixed', async ({ page }) => {
    await installMockSupabase(page, seed(), () => {
      sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
      localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    });
    await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
    await page.waitForTimeout(1200);
    await page.evaluate(() => openNewPatientModal());
    await page.fill('#npGeburtsdatum', '1990-01-01');
    await page.fill('#npSvnr', '1234 020190');
    await expect(page.locator('#npSvnrWarning')).toBeVisible();
    await page.fill('#npSvnr', '1234 010190');
    await expect(page.locator('#npSvnrWarning')).toBeHidden();
  });

  test('secretary.html "Patient bearbeiten": the warning reacts to edits on either field', async ({ page }) => {
    await installMockSupabase(page, seed(), () => {
      sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
      localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    });
    await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
    await page.waitForTimeout(1200);
    await page.evaluate(() => openPatientDetail('Maria Huber', '#0E5E56', 'ÖGK', 'Teststraße 1', '+43 660', '1234 010190', '1990-01-01', false, ''));
    await expect(page.locator('#pdSvnrWarning')).toBeHidden();
    await page.fill('#pdDob', '1991-01-01');
    await expect(page.locator('#pdSvnrWarning')).toBeVisible();
  });

  test('patient-login.html self-registration: the warning shows on a mismatch', async ({ page }) => {
    await installMockSupabase(page, {}, () => {});
    await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
    await page.waitForTimeout(800);
    await page.evaluate(() => showRequestScreen());
    await page.fill('#reqDob', '1990-01-01');
    await page.fill('#reqSvnr', '1234 020190');
    await expect(page.locator('#reqSvnrWarning')).toBeVisible();
    await page.fill('#reqSvnr', '1234 010190');
    await expect(page.locator('#reqSvnrWarning')).toBeHidden();
  });
});
