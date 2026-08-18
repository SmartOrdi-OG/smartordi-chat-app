// Regression test for a real bug report: chat message timestamps didn't
// match the reader's local time. Root cause: created_at comes back from
// Supabase as a UTC timestamptz string, and every place that turned it into
// a displayed "HH:MM" (vendor/patient-data.js's loadMessagesForPatientCached()
// and doctor.html's hydrateRealThreadFromSupabase(), secretary.html's
// realThreadFromSupabase(), vendor/patient-portal-data.js's
// patientGetMessages()) used to just slice characters 11-16 out of the raw
// UTC string -- displaying UTC time verbatim, off by the reader's own UTC
// offset (e.g. two hours in an Austrian summer). Fixed by parsing it as a
// real Date and formatting via toLocaleTimeString, which converts to the
// browser's local time -- this test forces a non-UTC timezone (Europe/Vienna)
// so the conversion is actually exercised, not accidentally correct because
// the test runner happens to be in UTC.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test.describe('formatMsgTime() converts UTC created_at to local time', () => {
  test.use({ timezoneId: 'Europe/Vienna' });

  // 14:30 UTC is 16:30 in Vienna during summer (UTC+2) -- the old
  // .slice(11,16) approach would have shown "14:30" instead.
  const UTC_CREATED_AT = '2026-08-18T14:30:00.000Z';
  const EXPECTED_LOCAL = '16:30';

  test('vendor/patient-data.js (staff side, loaded via doctor.html)', async ({ page }) => {
    await installMockSupabase(page, {});
    await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
    await page.waitForTimeout(500);
    const result = await page.evaluate((createdAt) => formatMsgTime(createdAt), UTC_CREATED_AT);
    expect(result).toBe(EXPECTED_LOCAL);
  });

  test('vendor/patient-portal-data.js (patient side, loaded via patient.html)', async ({ page }) => {
    await installMockSupabase(page, {});
    await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
    await page.waitForTimeout(500);
    const result = await page.evaluate((createdAt) => formatMsgTime(createdAt), UTC_CREATED_AT);
    expect(result).toBe(EXPECTED_LOCAL);
  });

  test('formatMsgTime() returns an empty string for a missing created_at instead of throwing', async ({ page }) => {
    await installMockSupabase(page, {});
    await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => formatMsgTime(null));
    expect(result).toBe('');
  });
});
