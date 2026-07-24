// Regression test for the fix to unbounded patient_messages growth
// (flagged as a real scaling risk: refreshAllMessages() used to fetch
// every message ever sent, for every patient, on every page load -- a
// bulk cache only ever used for the "Nachrichten" preview text and the
// unread-since-last-viewed count, see chat-unread-count.spec.js). Now
// scoped to the last ALL_MESSAGES_WINDOW_DAYS (365) via a .gte('created_at',
// cutoff) filter in vendor/patient-data.js. A single patient's full
// conversation history is unaffected -- getMessagesForPatient() (used the
// moment a specific chat is actually opened) has no such filter.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

test('the bulk messages cache only includes recent messages, not the patient\'s entire history', async ({ page }) => {
  const now = Date.now();
  const recent = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago
  const tooOld = new Date(now - 400 * 24 * 60 * 60 * 1000).toISOString(); // 400 days ago -- outside the 365-day window
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
    patient_messages: [
      { id: 'm-old', patient_id: 'p1', dir: 'in', type: 'text', text: 'ancient message', created_at: tooOld },
      { id: 'm-new', patient_id: 'p1', dir: 'in', type: 'text', text: 'recent message', created_at: recent },
    ],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const cached = await page.evaluate(() => loadMessagesForPatientCached('p1').map(m => m.text));
  expect(cached, 'a message older than the rolling window must not be in the bulk cache').not.toContain('ancient message');
  expect(cached, 'a recent message must still be in the bulk cache').toContain('recent message');

  // The patient's full history is still there -- getMessagesForPatient()
  // (the per-conversation fetch used when the chat is actually opened) has
  // no window filter at all.
  const full = await page.evaluate(() => getMessagesForPatient('p1').then(rows => rows.map(r => r.text)));
  expect(full, 'the real per-patient conversation history must never be windowed, only the bulk preview cache').toContain('ancient message');
  expect(full).toContain('recent message');
});
