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
    practices: [Object.assign({ id: 'prac1', name: 'Musterordination', plan: 'standard', trial_start: null }, practiceOverrides)],
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
  await setupPage(page, { plan: 'standard' });
  await page.route('https://checkout.stripe.com/test-session', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html>stripe checkout stub</html>' }));

  // Not awaited on purpose: confirmPlanChange() navigates the page away to
  // a different origin, which destroys this execution context mid-flight
  // if we wait on its promise here -- page.waitForURL() below is the real
  // assertion, confirming the redirect actually happened.
  await page.evaluate(() => {
    sb.functions.invoke = async () => ({ data: { url: 'https://checkout.stripe.com/test-session' }, error: null });
    openPlanChangeModal('enterprise');
    confirmPlanChange();
  });
  await page.waitForURL('https://checkout.stripe.com/test-session');
});

test('confirmPlanChange() sends the selected plan and a same-origin return URL to create-checkout-session', async ({ page }) => {
  await setupPage(page, { plan: 'standard' });
  // No url in the response -> confirmPlanChange() shows an error and never
  // navigates, so it's safe to read the captured args back afterwards.
  const invokeArgs = await page.evaluate(async () => {
    let captured = null;
    sb.functions.invoke = async (name, opts) => { captured = { name, opts }; return { data: null, error: { message: 'no session for this test' } }; };
    openPlanChangeModal('enterprise');
    await confirmPlanChange();
    return captured;
  });
  expect(invokeArgs.name).toBe('create-checkout-session');
  expect(invokeArgs.opts.body.plan).toBe('enterprise');
  expect(invokeArgs.opts.body.returnUrl).toContain('doctor.html');
});

// Regression test for a real billing bug found in a launch-readiness
// review (2026-07-30): create-checkout-session's `mode: "subscription"`
// always starts a brand-new Stripe subscription, even for a customer who
// already has one -- confirmPlanChange() used to call it unconditionally
// for every plan change, so a practice's SECOND (or later) plan switch
// silently doubled their real Stripe subscriptions/billing. An already-
// subscribed practice must go through create-billing-portal-session's
// plan-switch flow instead (see hasActiveStripeSubscription()).
test('confirmPlanChange() routes an already-subscribed practice through the Billing Portal, not a new Checkout session', async ({ page }) => {
  await setupPage(page, { plan: 'standard', stripe_customer_id: 'cus_123', stripe_subscription_id: 'sub_123', subscription_status: 'active' });
  const invokeArgs = await page.evaluate(async () => {
    let captured = null;
    sb.functions.invoke = async (name, opts) => { captured = { name, opts }; return { data: null, error: { message: 'no session for this test' } }; };
    openPlanChangeModal('enterprise');
    await confirmPlanChange();
    return captured;
  });
  expect(invokeArgs.name, 'must go through the Billing Portal\'s subscription-update flow, not open a second Checkout subscription').toBe('create-billing-portal-session');
  expect(invokeArgs.opts.body.plan).toBe('enterprise');
  expect(invokeArgs.opts.body.returnUrl).toContain('doctor.html');
});

test('confirmPlanChange() still uses Checkout for a practice with no active Stripe subscription yet', async ({ page }) => {
  await setupPage(page, { plan: 'standard', stripe_customer_id: null, stripe_subscription_id: null, subscription_status: null });
  const invokeArgs = await page.evaluate(async () => {
    let captured = null;
    sb.functions.invoke = async (name, opts) => { captured = { name, opts }; return { data: null, error: { message: 'no session for this test' } }; };
    openPlanChangeModal('enterprise');
    await confirmPlanChange();
    return captured;
  });
  expect(invokeArgs.name).toBe('create-checkout-session');
});

test('confirmPlanChange() uses Checkout again (not the Portal) once a previous subscription was cancelled', async ({ page }) => {
  await setupPage(page, { plan: 'standard', stripe_customer_id: 'cus_123', stripe_subscription_id: 'sub_old', subscription_status: 'canceled' });
  const invokeArgs = await page.evaluate(async () => {
    let captured = null;
    sb.functions.invoke = async (name, opts) => { captured = { name, opts }; return { data: null, error: { message: 'no session for this test' } }; };
    openPlanChangeModal('enterprise');
    await confirmPlanChange();
    return captured;
  });
  expect(invokeArgs.name, 'a cancelled subscription has nothing left for the Portal to update -- must start a fresh Checkout subscription').toBe('create-checkout-session');
});

test('confirmPlanChange() shows an error and stays on the page if the Edge Function fails', async ({ page }) => {
  await setupPage(page, { plan: 'standard' });
  const result = await page.evaluate(async () => {
    sb.functions.invoke = async () => ({ data: null, error: { message: 'network error' } });
    openPlanChangeModal('enterprise');
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

// Regression test: a live incident showed the exact same blanket
// "Weiterleitung zu Stripe fehlgeschlagen" text no matter the real cause
// (missing STRIPE_SECRET_KEY, an unconfigured price ID, a genuine Stripe
// rejection...), leaving no way to tell which without going into the Edge
// Function's own server logs. extractFunctionErrorDetail() now surfaces the
// real reason inline instead.
test('confirmPlanChange() surfaces the underlying error message, not just a generic "fehlgeschlagen"', async ({ page }) => {
  await setupPage(page, { plan: 'standard' });
  const result = await page.evaluate(async () => {
    sb.functions.invoke = async () => ({ data: null, error: { message: 'network error' } });
    openPlanChangeModal('enterprise');
    await confirmPlanChange();
    return { errorText: document.getElementById('pcErrorMsg').textContent };
  });
  expect(result.errorText).toContain('network error');
});

test('confirmPlanChange() reads the real reason out of a non-2xx Edge Function response body instead of the generic wrapper message', async ({ page }) => {
  await setupPage(page, { plan: 'standard' });
  const result = await page.evaluate(async () => {
    const fakeResponse = { clone(){ return this; }, json: async () => ({ error: 'unknown_or_unconfigured_plan' }) };
    sb.functions.invoke = async () => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: fakeResponse } });
    openPlanChangeModal('enterprise');
    await confirmPlanChange();
    return { errorText: document.getElementById('pcErrorMsg').textContent };
  });
  expect(result.errorText).toContain('unknown_or_unconfigured_plan');
});

test('manageBilling() also surfaces the underlying error, not just a generic toast', async ({ page }) => {
  await setupPage(page, { plan: 'enterprise', stripe_customer_id: 'cus_123', payment_method: { method: 'card', brand: 'visa', last4: '4242' } });
  const result = await page.evaluate(async () => {
    sb.functions.invoke = async () => ({ data: null, error: { message: 'STRIPE_SECRET_KEY not configured' } });
    await manageBilling();
    return { toastText: document.getElementById('toast')?.textContent || '' };
  });
  expect(result.toastText).toContain('STRIPE_SECRET_KEY not configured');
});

test('manageBilling() redirects to the Billing Portal URL for an already-subscribed practice', async ({ page }) => {
  await setupPage(page, { plan: 'enterprise', stripe_customer_id: 'cus_123', payment_method: { method: 'card', brand: 'visa', last4: '4242' } });
  await page.route('https://billing.stripe.com/test-portal', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html>stripe portal stub</html>' }));

  await page.evaluate(async () => {
    sb.functions.invoke = async () => ({ data: { url: 'https://billing.stripe.com/test-portal' }, error: null });
    manageBilling();
  });
  await page.waitForURL('https://billing.stripe.com/test-portal');
});

test('renderPlanSettings() only offers "Zahlungsmethode verwalten" once a real Stripe customer exists', async ({ page }) => {
  await setupPage(page, { plan: 'standard', stripe_customer_id: null, payment_method: null });
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
  await setupPage(page, { plan: 'standard', stripe_customer_id: null, payment_method: null });
  // Simulate stripe-webhook having already landed by the time the browser
  // gets redirected back -- the point of this function is to pick that up,
  // not to assume it, so seed the store as if the webhook already ran.
  await page.evaluate(() => {
    window.__store.practices[0].plan = 'enterprise';
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
  expect(result.plan).toBe('enterprise');
  expect(result.urlHasCheckoutParam, 'the ?checkout= param must be stripped so a refresh does not re-trigger this').toBe(false);
});

test('handleStripeCheckoutReturn(): a cancelled return shows a plain cancellation toast without touching practice data', async ({ page }) => {
  await setupPage(page, { plan: 'standard' });
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
  expect(result.plan).toBe('standard');
});
