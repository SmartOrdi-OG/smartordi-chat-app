// Regression test: doctor.html must never persist a full card number or
// expiry date -- only last4, per the urgent PCI-DSS finding logged in
// TODO.md. Storing the full PAN in plaintext with no real payment
// processor involved is exactly what this test guards against regressing.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('confirmPlanChange() only ever persists {method, last4}, never the full card number/expiry', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed', practice_id: 'prac1' }],
    practices: [{ id: 'prac1', name: 'Ordination', adresse: 'Adresse 1', tel: '+43 1', plan: 'pro', trial_start: '2026-01-01T00:00:00Z', payment_method: null, created_at: '2026-01-01T00:00:00Z' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ u1: { username: 'u1', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    await practiceSettingsReady;
    pendingPlan = 'pro';
    document.getElementById('pcMethodCard').classList.add('selected');
    document.getElementById('pcCardNumber').value = '4111 1111 1111 1234';
    document.getElementById('pcCardExpiry').value = '08/29';
    document.getElementById('pcCardCvc').value = '123';
    await confirmPlanChange();
    await new Promise(r => setTimeout(r, 50));
    const stored = window.__store.practices[0].payment_method;
    openPlanChangeModal('pro', true);
    return {
      stored,
      displaySummary: getPaymentMethod() && getPaymentMethod().method === 'card' ? getPaymentMethod().last4 : null,
      reopenedCardNumberField: document.getElementById('pcCardNumber').value,
      reopenedExpiryField: document.getElementById('pcCardExpiry').value,
    };
  });

  expect(result.stored).toEqual({ method: 'card', last4: '1234' });
  expect(JSON.stringify(result.stored)).not.toContain('4111111111111234');
  expect(result.stored).not.toHaveProperty('number');
  expect(result.stored).not.toHaveProperty('expiry');
  expect(result.displaySummary, 'masked last4 display must still work').toBe('1234');
  expect(result.reopenedCardNumberField, 'reopening must not prefill the old full card number').toBe('');
  expect(result.reopenedExpiryField, 'reopening must not prefill the old expiry').toBe('');
});
