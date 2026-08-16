// Regression test for ensureLabEmailToken()/slugifyPracticeName()
// (vendor/staff-accounts.js): the "Labor-E-Mail" address handed out to a
// lab used to be lab-<32 random hex chars>@labs.smartordi.eu -- unwieldy
// to read out over the phone or type into a lab's LIS by hand. Replaced
// with a shorter, readable address built from the practice's own name
// (slugified, German umlauts transliterated) plus a short random suffix,
// with a one-time silent upgrade for any practice that already generated
// the old long format (safe since Cloudflare Email Routing for
// labs.smartordi.eu isn't live yet -- see TODO.md -- so no lab could
// already have been given the old address to actually use).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(practiceOverrides) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'u1', practice_id: 'prac1' }],
    practices: [Object.assign({
      id: 'prac1', name: 'Ordination Dr. Müller', adresse: 'x', tel: 'y', chat_enabled: true,
      plan: 'standard', trial_start: '2026-01-01T00:00:00Z', payment_method: null, created_at: '2026-01-01T00:00:00Z',
    }, practiceOverrides)],
  };
}

async function setupDoctor(page, practiceOverrides) {
  await installMockSupabase(page, seed(practiceOverrides), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ u1: { username: 'u1', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
}

test('slugifyPracticeName() transliterates umlauts, strips punctuation, and caps length', async ({ page }) => {
  await setupDoctor(page);
  const result = await page.evaluate(() => ({
    umlauts: slugifyPracticeName('Dr. Müller & Söhne'),
    empty: slugifyPracticeName(''),
    long: slugifyPracticeName('Facharztordination für Allgemeinmedizin und Innere Medizin Dr. Hans Bauer'),
  }));
  expect(result.umlauts).toBe('dr-mueller-soehne');
  expect(result.empty).toBe('praxis');
  expect(result.long.length).toBeLessThanOrEqual(24);
  expect(result.long.startsWith('-')).toBe(false);
  expect(result.long.endsWith('-')).toBe(false);
});

test('ensureLabEmailToken() generates a short, readable address from the practice name', async ({ page }) => {
  await setupDoctor(page);
  const result = await page.evaluate(async () => {
    await practiceSettingsReady;
    const token = await ensureLabEmailToken();
    return { token, address: labInboundEmailAddress(token), stored: window.__store.practices[0].lab_email_token };
  });
  expect(result.token).toMatch(/^ordination-dr-mueller-[0-9a-f]{6}$/);
  expect(result.address).toBe(`lab-${result.token}@labs.smartordi.eu`);
  expect(result.stored).toBe(result.token);
});

test('ensureLabEmailToken() returns an already-generated new-format token unchanged', async ({ page }) => {
  await setupDoctor(page, { lab_email_token: 'ordination-dr-mueller-abc123' });
  const token = await page.evaluate(async () => {
    await practiceSettingsReady;
    return ensureLabEmailToken();
  });
  expect(token).toBe('ordination-dr-mueller-abc123');
});

test('ensureLabEmailToken() upgrades a legacy long-format token to the new short format', async ({ page }) => {
  const legacyToken = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'; // 32 hex chars, old format
  await setupDoctor(page, { lab_email_token: legacyToken });
  const result = await page.evaluate(async () => {
    await practiceSettingsReady;
    const token = await ensureLabEmailToken();
    return { token, stored: window.__store.practices[0].lab_email_token };
  });
  expect(result.token).not.toBe(legacyToken);
  expect(result.token).toMatch(/^ordination-dr-mueller-[0-9a-f]{6}$/);
  expect(result.stored).toBe(result.token);
});

test('ensureLabEmailToken() retries once on a simulated unique-constraint collision and still succeeds', async ({ page }) => {
  await setupDoctor(page);
  const result = await page.evaluate(async () => {
    await practiceSettingsReady;
    // doctor.html's own DOMContentLoaded already auto-generated a token on
    // page load (Einstellungen's "Labor-E-Mail" field) -- clear it so this
    // test's explicit call below actually goes through the generate-and-
    // save path instead of hitting ensureLabEmailToken()'s "already
    // exists" early return.
    window.__store.practices[0].lab_email_token = null;
    await refreshPracticeSettings();
    let calls = 0;
    window.__forceError = {};
    Object.defineProperty(window.__forceError, 'practices', {
      configurable: true,
      get() {
        calls++;
        return calls === 1 ? { code: '23505', message: 'duplicate key value violates unique constraint "practices_lab_email_token_key"' } : undefined;
      },
    });
    const token = await ensureLabEmailToken();
    delete window.__forceError;
    return { token, calls };
  });
  expect(result.calls).toBeGreaterThanOrEqual(2);
  expect(result.token).toMatch(/^ordination-dr-mueller-[0-9a-f]{6}$/);
});
