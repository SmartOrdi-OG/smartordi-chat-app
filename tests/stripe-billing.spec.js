// Regression test for the real Stripe billing flow in doctor.html
// (confirmPlanChange()/manageBilling()/handleStripeCheckoutReturn()),
// which replaced the old fake card/IBAN form that never actually charged
// anything -- see supabase/functions/create-checkout-session,
// create-billing-portal-session, stripe-webhook, and
// supabase/phase26_stripe_billing.sql. Edge Function/webhook logic itself
// is Deno server code this Playwright suite can't exercise (same
// limitation as the pre-existing send-report-email/receive-lab-email
// functions, which also have no automated coverage) -- this only covers
// the client-side half: does doctor.html call the right Edge Function
// with the right arguments, and does it react correctly to what comes back.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(practiceOverrides) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed', practice_id: 'prac1' }],
    practices: [Object.assign({ id: 'prac1', name: 'Musterordination', plan: 'basic', trial_start: null }, practiceOverrides)],
  };
}

async function setupPage(page, practiceOverrides) {
  await installMockSupabase(page, seed(practiceOverrides), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await practiceSettingsReady; });
}

test('confirmPlanChange() redirects to the checkout URL create-checkout-session returns', async ({ page }) => {
  await setupPage(page, { plan: 'basic' });
  await page.route('https://checkout.stripe.com/test-session', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html>stripe checkout stub</html>' }));

  // Not awaited on purpose: confirmPlanChange() navigates the page away to
  // a different origin, which destroys this execution context mid-flight
  // if we wait on its promise here -- page.waitForURL() below is the real
  // assertion, confirming the redirect actually happened.
  await page.evaluate(() => {
    sb.functions.invoke = async () => ({ data: { url: 'https://checkout.stripe.com/test-session' }, error: null });
    openPlanChangeModal('pro');
    confirmPlanChange();
  });
  await page.waitForURL('https://checkout.stripe.com/test-session');
});

test('confirmPlanChange() sends the selected plan and a same-origin return URL to create-checkout-session', async ({ page }) => {
  await setupPage(page, { plan: 'basic' });
  // No url in the response -> confirmPlanChange() shows an error and never
  // navigates, so it's safe to read the captured args back afterwards.
  const invokeArgs = await page.evaluate(async () => {
    let captured = null;
    sb.functions.invoke = async (name, opts) => { captured = { name, opts }; return { data: null, error: { message: 'no session for this test' } }; };
    openPlanChangeModal('pro');
    await confirmPlanChange();
    return captured;
  });
  expect(invokeArgs.name).toBe('create-checkout-session');
  expect(invokeArgs.opts.body.plan).toBe('pro');
  expect(invokeArgs.opts.body.returnUrl).toContain('doctor.html');
});

test('confirmPlanChange() shows an error and stays on the page if the Edge Function fails', async ({ page }) => {
  await setupPage(page, { plan: 'basic' });
  const result = await page.evaluate(async () => {
    sb.functions.invoke = async () => ({ data: null, error: { message: 'network error' } });
    openPlanChangeModal('pro');
    await confirmPlanChange();
    return {
      errorVisible: document.getElementById('pcErrorMsg').style.display !== 'none',
      errorText: document.getElementById('pcErrorMsg').textContent,
      btnDisabled: document.getElementById('pcConfirmBtn').disabled,
    };
  });
  expect(result.errorVisible).toBe(true);
  expect(result.errorText).toContain('fehlgeschlagen');
  expect(result.btnDisabled, 'the button must be re-enabled so the doctor can retry').toBe(false);
  expect(page.url()).toContain('doctor.html');
});

test('manageBilling() redirects to the Billing Portal URL for an already-subscribed practice', async ({ page }) => {
  await setupPage(page, { plan: 'pro', stripe_customer_id: 'cus_123', payment_method: { method: 'card', brand: 'visa', last4: '4242' } });
  await page.route('https://billing.stripe.com/test-portal', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html>stripe portal stub</html>' }));

  await page.evaluate(async () => {
    sb.functions.invoke = async () => ({ data: { url: 'https://billing.stripe.com/test-portal' }, error: null });
    manageBilling();
  });
  await page.waitForURL('https://billing.stripe.com/test-portal');
});

test('renderPlanSettings() only offers "Zahlungsmethode verwalten" once a real Stripe customer exists', async ({ page }) => {
  await setupPage(page, { plan: 'basic', stripe_customer_id: null, payment_method: null });
  const before = await page.evaluate(() => { renderPlanSettings(); return document.getElementById('planSettingsBody').innerHTML.includes('manageBilling()'); });
  expect(before, 'no Stripe customer yet -- nothing to manage').toBe(false);

  await page.evaluate(async () => {
    window.__store.practices[0].stripe_customer_id = 'cus_123';
    window.__store.practices[0].payment_method = { method: 'card', brand: 'mastercard', last4: '1234' };
    await refreshPracticeSettings();
    renderPlanSettings();
  });
  const after = await page.evaluate(() => document.getElementById('planSettingsBody').innerHTML);
  expect(after).toContain('manageBilling()');
  expect(after).toContain('Mastercard');
  expect(after).toContain('1234');
});

test('handleStripeCheckoutReturn(): a successful return refreshes practice settings, shows a toast, and cleans the URL', async ({ page }) => {
  await setupPage(page, { plan: 'basic', stripe_customer_id: null, payment_method: null });
  // Simulate stripe-webhook having already landed by the time the browser
  // gets redirected back -- the point of this function is to pick that up,
  // not to assume it, so seed the store as if the webhook already ran.
  await page.evaluate(() => {
    window.__store.practices[0].plan = 'pro';
    window.__store.practices[0].stripe_customer_id = 'cus_123';
    window.__store.practices[0].payment_method = { method: 'card', brand: 'visa', last4: '4242' };
    const url = new URL(window.location.href);
    url.searchParams.set('checkout', 'success');
    history.replaceState(null, '', url);
  });
  const result = await page.evaluate(async () => {
    await handleStripeCheckoutReturn();
    return {
      toastText: document.getElementById('toast')?.textContent || '',
      plan: getPlan(),
      urlHasCheckoutParam: window.location.search.includes('checkout'),
    };
  });
  expect(result.toastText).toContain('erfolgreich');
  expect(result.plan).toBe('pro');
  expect(result.urlHasCheckoutParam, 'the ?checkout= param must be stripped so a refresh does not re-trigger this').toBe(false);
});

test('handleStripeCheckoutReturn(): a cancelled return shows a plain cancellation toast without touching practice data', async ({ page }) => {
  await setupPage(page, { plan: 'basic' });
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('checkout', 'cancelled');
    history.replaceState(null, '', url);
  });
  const result = await page.evaluate(async () => {
    await handleStripeCheckoutReturn();
    return { toastText: document.getElementById('toast')?.textContent || '', plan: getPlan() };
  });
  expect(result.toastText).toContain('abgebrochen');
  expect(result.plan).toBe('basic');
});
