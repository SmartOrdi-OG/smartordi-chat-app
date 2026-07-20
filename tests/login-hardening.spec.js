// Regression test for supabase/phase14_patient_login_hardening.sql's
// account-lockout / temp-password-expiry states surfacing as specific,
// translated messages on patient-login.html instead of a generic failure.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

const scenarios = [
  { label: 'account_locked', rpcErrorMessage: 'account_locked', expectSubstring: 'versuch' },
  { label: 'temp_password_expired', rpcErrorMessage: 'temp_password_expired', expectSubstring: 'abgelaufen' },
  { label: 'normal wrong password', rpcErrorMessage: null, expectSubstring: null },
];

for (const { label, rpcErrorMessage, expectSubstring } of scenarios) {
  test(`patient-login.html shows the right message for: ${label}`, async ({ page }) => {
    await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
      localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    });
    await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
    await page.waitForTimeout(1000);

    await page.evaluate((errMsg) => {
      sb.rpc = (name) => {
        if (name === 'patient_login') {
          return Promise.resolve({ data: null, error: errMsg ? { message: errMsg } : null });
        }
        if (name === 'check_join_request_status') return Promise.resolve({ data: [], error: null });
        return Promise.resolve({ data: null, error: null });
      };
    }, rpcErrorMessage);

    await page.fill('#username', 'testpatient');
    await page.fill('#password', 'whatever');
    await page.evaluate(() => doLogin());
    await page.waitForTimeout(1000);

    const result = await page.evaluate(() => ({
      errorVisible: document.getElementById('errorMsg').classList.contains('show'),
      errorText: document.getElementById('errorText').textContent,
    }));

    expect(result.errorVisible, 'an error message must be shown').toBe(true);
    if (expectSubstring) {
      expect(result.errorText.toLowerCase()).toContain(expectSubstring);
    } else {
      expect(result.errorText.length).toBeGreaterThan(0);
    }
  });
}
