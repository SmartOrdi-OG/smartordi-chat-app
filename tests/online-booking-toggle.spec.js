// Regression tests for supabase/phase44_online_booking_toggle.sql's
// practice-wide "Online-Terminbuchung" switch, toggled from the
// secretary's account (secretary.html Terminverwaltung) -- user request:
// a way to close online appointment booking for patients for a while
// (e.g. fully booked) without affecting existing appointments or staff's
// own ability to book on a patient's behalf. Mirrors
// tests/chat-toggle-practice-wide.spec.js's structure for the analogous
// chat_enabled switch.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(practiceOverrides) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'u1', practice_id: 'prac1' }],
    practices: [Object.assign({ id: 'prac1', name: 'Test Praxis', online_booking_enabled: true }, practiceOverrides)],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  };
}

async function setupSecretary(page, practiceOverrides) {
  await installMockSupabase(page, seed(practiceOverrides), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ u1: { username: 'u1', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
}

test('secretary.html: the toggle button reflects the default (enabled) state', async ({ page }) => {
  await setupSecretary(page);
  const text = await page.evaluate(() => document.getElementById('onlineBookingToggleBtn').textContent);
  expect(text).toContain('aktiv');
});

test('secretary.html: toggleOnlineBooking() disables booking, persists it, and updates the button', async ({ page }) => {
  await setupSecretary(page);
  const result = await page.evaluate(async () => {
    await practiceSettingsReady;
    await toggleOnlineBooking();
    return {
      saved: window.__store.practices[0].online_booking_enabled,
      btnText: document.getElementById('onlineBookingToggleBtn').textContent,
      stillEnabled: isOnlineBookingEnabled(),
    };
  });
  expect(result.saved).toBe(false);
  expect(result.btnText).toContain('gesperrt');
  expect(result.stillEnabled).toBe(false);
  await expect(page.locator('#toast')).toHaveText('Online-Buchung für Patienten gesperrt');
});

test('secretary.html: a failed save shows an error toast and leaves the actual setting untouched', async ({ page }) => {
  await setupSecretary(page);
  await page.evaluate(() => { window.__forceError = { practices: 'simulated db error' }; });
  const result = await page.evaluate(async () => {
    await practiceSettingsReady;
    await toggleOnlineBooking();
    return { stillEnabled: isOnlineBookingEnabled(), btnText: document.getElementById('onlineBookingToggleBtn').textContent };
  });
  expect(result.stillEnabled, 'a failed save must not leave the app believing the setting actually changed').toBe(true);
  expect(result.btnText).toContain('aktiv');
  await expect(page.locator('#toast')).toHaveText('Speichern fehlgeschlagen: simulated db error');
});

test('secretary.html: an existing appointment stays untouched by disabling online booking', async ({ page }) => {
  await setupSecretary(page, {});
  await page.evaluate(() => {
    window.__store.termine.push({ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: '2026-08-01', time: '09:00', end_time: '09:20', status: 'bestaetigt', arzt_id: 'u1' });
  });
  await page.evaluate(async () => { await practiceSettingsReady; await toggleOnlineBooking(); });
  const termin = await page.evaluate(() => window.__store.termine.find(t => t.id === 't1'));
  expect(termin.status).toBe('bestaetigt');
});

test('patient.html: online booking disabled hides the booking controls and shows a notice', async ({ page }) => {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [{ id: 'p1', username: 'maria', name: 'Maria', full_name: 'Maria Huber', dob: '1985-01-01', first_login: false }], error: null });
      if (name === 'patient_get_booking_enabled') return Promise.resolve({ data: false, error: null });
      if (name === 'patient_book_termin') return Promise.resolve({ data: null, error: { message: 'should not be called' } });
      return Promise.resolve({ data: [], error: null });
    };
  });
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => ({
    controlsHidden: document.getElementById('bookingControls').style.display === 'none',
    noticeShown: document.getElementById('bookingDisabledNotice').style.display !== 'none',
    noticeText: document.getElementById('bookingDisabledNotice').textContent,
  }));
  expect(state.controlsHidden).toBe(true);
  expect(state.noticeShown).toBe(true);
  expect(state.noticeText).toContain('nicht verfügbar');

  // Defense in depth: even a direct bookTermin() call must not reach the RPC.
  const rpcCalled = await page.evaluate(async () => {
    let called = false;
    const originalRpc = sb.rpc;
    sb.rpc = (name, args) => { if (name === 'patient_book_termin') called = true; return originalRpc(name, args); };
    selectedDay = 1; selectedArzt = 'u1'; selectedSlot = '09:00';
    await bookTermin();
    return called;
  });
  expect(rpcCalled).toBe(false);
});

test('patient.html: online booking enabled (the default) shows the normal booking controls, not the notice', async ({ page }) => {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [{ id: 'p1', username: 'maria', name: 'Maria', full_name: 'Maria Huber', dob: '1985-01-01', first_login: false }], error: null });
      if (name === 'patient_get_booking_enabled') return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: [], error: null });
    };
  });
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => ({
    controlsHidden: document.getElementById('bookingControls').style.display === 'none',
    noticeShown: document.getElementById('bookingDisabledNotice').style.display !== 'none',
  }));
  expect(state.controlsHidden).toBe(false);
  expect(state.noticeShown).toBe(false);
});

// Race-condition path: the UI thought booking was enabled (practice toggled
// it off in the moment between page load and this click), so the RPC
// itself is the one rejecting -- patient_book_termin() raises
// 'booking_disabled' server-side regardless of what the client believed.
test('patient.html: a server-side booking_disabled rejection shows the right toast and re-hides the controls', async ({ page }) => {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [{ id: 'p1', username: 'maria', name: 'Maria', full_name: 'Maria Huber', dob: '1985-01-01', first_login: false }], error: null });
      if (name === 'patient_get_booking_enabled') return Promise.resolve({ data: true, error: null });
      if (name === 'patient_book_termin') return Promise.resolve({ data: null, error: { message: 'booking_disabled' } });
      return Promise.resolve({ data: [], error: null });
    };
  });
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);

  const result = await page.evaluate(async () => {
    // Real user request (2026-08-17): choosing a Grund des Besuchs is now
    // mandatory (see tests/termin-visit-reason.spec.js) -- selected here so
    // this test still reaches the actual scenario it's about (a server-side
    // race-condition rejection), not the unrelated "no reason chosen" one.
    document.getElementById('terminArt').value = 'Kontrolle';
    selectedDay = 1; selectedArzt = 'u1'; selectedSlot = '09:00';
    await bookTermin();
    return {
      toastText: document.getElementById('toast')?.textContent || '',
      controlsHidden: document.getElementById('bookingControls').style.display === 'none',
      noticeShown: document.getElementById('bookingDisabledNotice').style.display !== 'none',
    };
  });
  expect(result.toastText).toContain('nicht verfügbar');
  expect(result.controlsHidden).toBe(true);
  expect(result.noticeShown).toBe(true);
});
