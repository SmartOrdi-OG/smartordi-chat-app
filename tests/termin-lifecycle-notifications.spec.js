// Regression test for secretary.html's confirm/cancel/reschedule actions on
// an existing Termin (confirmTermin/cancelTermin/confirmMove) -- these used
// to just claim "SMS gesendet" without ever actually notifying the patient
// anywhere real (see sendPatientChatMessage()'s own header comment); they
// now push a real message into the patient's chat thread when the patient
// has an actual account, and fall back to a plain confirmation (no false
// "informiert" claim) when they don't (e.g. a name that doesn't match any
// real patient). None of these three functions -- nor findTermineConflict's
// sibling state-change actions -- had any test coverage before this file;
// only booking-time conflict detection (double-booking.spec.js) did.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function baseSeed(terminOverrides) {
  return {
    staff_profiles: [
      { id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' },
    ],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
    termine: [Object.assign({
      id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle',
      date: '2026-08-15', time: '09:30', end_time: '10:00', status: 'neu', arzt_id: 'u1',
      created_at: new Date().toISOString(),
    }, terminOverrides)],
  };
}

async function setupPage(page, terminOverrides) {
  await installMockSupabase(page, baseSeed(terminOverrides), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({
      'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, termineReady]); });
}

test('confirmTermin() marks the appointment confirmed and messages a real patient account', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    await confirmTermin('t1');
    const t = loadTermine().find(x => x.id === 't1');
    return {
      status: t.status,
      toastText: document.getElementById('toast').textContent,
      messages: (findPatientByFullName('Maria Huber').accounts['maria.huber'].messages || []),
    };
  });
  expect(result.status).toBe('bestaetigt');
  expect(result.toastText).toContain('Patient per Chat benachrichtigt');
  expect(result.messages.length).toBe(1);
  expect(result.messages[0].dir).toBe('out');
  expect(result.messages[0].text).toContain('bestätigt');
  expect(result.messages[0].text).toContain('Dr. Sarah Ahmed');
  expect(result.messages[0].text).toContain('15. August 2026');
});

test('confirmTermin() does not claim to have messaged a patient with no real account', async ({ page }) => {
  await setupPage(page, { patient_name: 'Unbekannt Niemand', patient_id: null });
  const result = await page.evaluate(async () => {
    await confirmTermin('t1');
    const t = loadTermine().find(x => x.id === 't1');
    return { status: t.status, toastText: document.getElementById('toast').textContent };
  });
  expect(result.status).toBe('bestaetigt');
  expect(result.toastText).toBe('✓ Bestätigt');
  expect(result.toastText).not.toContain('informiert');
});

test('cancelTermin() marks the appointment cancelled and sends a cancellation chat message', async ({ page }) => {
  await setupPage(page, { status: 'bestaetigt' });
  const result = await page.evaluate(async () => {
    await cancelTermin('t1');
    const t = loadTermine().find(x => x.id === 't1');
    return {
      status: t.status,
      toastText: document.getElementById('toast').textContent,
      messages: (findPatientByFullName('Maria Huber').accounts['maria.huber'].messages || []),
    };
  });
  expect(result.status).toBe('abgesagt');
  expect(result.toastText).toContain('Patient per Chat informiert');
  expect(result.messages.length).toBe(1);
  expect(result.messages[0].text).toContain('abgesagt');
});

test('confirmMove() rejects an end time at or before the new start time without touching the appointment', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    openMoveModal('t1');
    document.getElementById('moveNewTime').value = '11:00';
    document.getElementById('moveNewEndTime').value = '11:00';
    await confirmMove();
    const t = loadTermine().find(x => x.id === 't1');
    return {
      toastText: document.getElementById('toast').textContent,
      time: t.time,
      modalStillOpen: document.getElementById('moveModal').classList.contains('show'),
    };
  });
  expect(result.toastText).toContain('Endzeit muss nach der Startzeit liegen');
  expect(result.time, 'the original time must be untouched when validation fails').toBe('09:30');
  expect(result.modalStillOpen, 'the modal should stay open so the secretary can correct the input').toBe(true);
});

test('confirmMove() reschedules the appointment, messages the patient with the new time, and closes the modal', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    openMoveModal('t1');
    document.getElementById('moveDate').value = '2026-08-20';
    document.getElementById('moveNewTime').value = '14:00';
    document.getElementById('moveNewEndTime').value = '14:30';
    await confirmMove();
    const t = loadTermine().find(x => x.id === 't1');
    return {
      toastText: document.getElementById('toast').textContent,
      date: t.date, time: t.time, endTime: t.endTime,
      modalOpen: document.getElementById('moveModal').classList.contains('show'),
      messages: (findPatientByFullName('Maria Huber').accounts['maria.huber'].messages || []),
    };
  });
  expect(result.date).toBe('2026-08-20');
  expect(result.time).toBe('14:00');
  expect(result.endTime).toBe('14:30');
  expect(result.modalOpen).toBe(false);
  expect(result.toastText).toContain('Patient per Chat benachrichtigt');
  expect(result.messages.length).toBe(1);
  expect(result.messages[0].text).toContain('verschoben');
  expect(result.messages[0].text).toContain('20. August 2026');
  expect(result.messages[0].text).toContain('14:00–14:30');
});
