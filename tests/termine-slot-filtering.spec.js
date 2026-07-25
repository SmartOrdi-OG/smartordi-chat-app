// Regression test for two related fixes to secretary.html's termin booking:
//
// 1. findTermineConflict() used to compare only the exact start `time`, so
//    two appointments with different start times could still genuinely
//    overlap (a 09:00-09:45 booking never blocked a 09:15 one) and slip
//    through undetected. It now compares real [start,end) ranges.
//
// 2. The Uhrzeit/Bis <select> lists used to always show every practice slot
//    regardless of what's already booked -- the secretary could pick an
//    already-taken slot and only find out after clicking "Termin erstellen"
//    (and the resulting error toast rendered invisibly behind the modal,
//    fixed separately). Booking forms now filter the slot lists live, per
//    doctor + date, using the same overlap logic.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extra) {
  return Object.assign({
    staff_profiles: [
      { id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' },
      { id: 'u2', vorname: 'Jonas', nachname: 'Berger', full_name: 'Dr. Jonas Berger', role: 'arzt', fach: 'Kardiologie', is_admin: false, email: 'j@a.at', username: 'dr.berger' },
    ],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  }, extra);
}

async function setupPage(page, extraSeed) {
  await installMockSupabase(page, seed(extraSeed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({
      'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' },
      'dr.berger': { username: 'dr.berger', fullName: 'Dr. Jonas Berger', role: 'arzt', isAdmin: false, fach: 'Kardiologie' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, termineReady]); });
}

test('findTermineConflict() catches a real overlap even when the start times differ', async ({ page }) => {
  await setupPage(page, {
    termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: '2026-08-17', time: '09:00', end_time: '09:45', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() }],
  });
  const result = await page.evaluate(() => ({
    overlapsMidway: findTermineConflict({ date: '2026-08-17', time: '09:15', endTime: '09:30', arztUsername: 'u1', patient: 'Someone Else' }),
    overlapsAtStart: findTermineConflict({ date: '2026-08-17', time: '08:45', endTime: '09:15', arztUsername: 'u1', patient: 'Someone Else' }),
    backToBackAfter: findTermineConflict({ date: '2026-08-17', time: '09:45', endTime: '10:00', arztUsername: 'u1', patient: 'Someone Else' }),
    differentDoctorSameSlot: findTermineConflict({ date: '2026-08-17', time: '09:15', endTime: '09:30', arztUsername: 'u2', patient: 'Someone Else' }),
  }));
  expect(result.overlapsMidway, 'a booking entirely inside the existing range must conflict').toBe('arzt');
  expect(result.overlapsAtStart, 'a booking that straddles the existing range\'s start must conflict').toBe('arzt');
  expect(result.backToBackAfter, 'starting exactly when the existing appointment ends is not a conflict').toBeNull();
  expect(result.differentDoctorSameSlot, 'a different doctor at the same overlapping time is unaffected').toBeNull();
});

test('the Uhrzeit list hides slots already covered by an existing appointment, per doctor', async ({ page }) => {
  await setupPage(page, {
    termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: '2026-08-17', time: '09:00', end_time: '09:45', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() }],
  });
  const result = await page.evaluate(() => {
    openNewTerminModal();
    document.getElementById('newTerminDate').value = '2026-08-17';
    document.getElementById('ntArzt').value = 'u1';
    refreshTermineSlotOptions(NT_SLOT_IDS);
    const forDrAhmed = [...document.getElementById('ntTime').options].map(o => o.value);
    document.getElementById('ntArzt').value = 'u2';
    refreshTermineSlotOptions(NT_SLOT_IDS);
    const forDrBerger = [...document.getElementById('ntTime').options].map(o => o.value);
    return { forDrAhmed, forDrBerger };
  });
  expect(result.forDrAhmed, 'Dr. Ahmed is busy 09:00-09:45, those starts must be hidden').not.toEqual(expect.arrayContaining(['09:00', '09:15', '09:30']));
  expect(result.forDrAhmed, 'the slot right at/after the busy block must still be offered').toEqual(expect.arrayContaining(['09:45', '08:45']));
  expect(result.forDrBerger, 'a different, free doctor must see every slot').toEqual(expect.arrayContaining(['09:00', '09:15', '09:30', '09:45']));
});

test('the Bis list is capped so you cannot pick an end time that would overlap the next appointment', async ({ page }) => {
  await setupPage(page, {
    termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: '2026-08-17', time: '10:00', end_time: '10:30', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() }],
  });
  const endOptions = await page.evaluate(() => {
    openNewTerminModal();
    document.getElementById('newTerminDate').value = '2026-08-17';
    document.getElementById('ntArzt').value = 'u1';
    document.getElementById('ntTime').innerHTML = '<option>09:30</option>';
    refreshTermineEndOptions(NT_SLOT_IDS);
    return [...document.getElementById('ntEndTime').options].map(o => o.value);
  });
  expect(endOptions, 'Bis may go right up to the next appointment\'s start (10:00)').toContain('10:00');
  expect(endOptions, 'Bis must not offer anything past the next appointment\'s start').not.toEqual(expect.arrayContaining(['10:15', '10:30']));
});

test('patient.html (local/demo account): time slots taken by a longer existing appointment are hidden by real duration, not just its exact start', async ({ page }) => {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({
      maria: { fullName: 'Maria Huber', name: 'Maria', role: 'patient', messages: [] },
    }));
    localStorage.setItem('smartordi_termine', JSON.stringify([
      { id: 't1', patient: 'Someone Else', arztUsername: 'dr.ahmed', date: '2026-08-17', time: '09:00', endTime: '09:45', status: 'bestaetigt' },
    ]));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);

  const result = await page.evaluate(() => {
    selectedArzt = 'dr.ahmed';
    selectedDay = 17;
    currentDate = new Date(2026, 7, 1); // August 2026 (JS months are 0-indexed)
    renderTimeSlots();
    const slots = [...document.querySelectorAll('#timeSlots .time-slot')];
    return {
      taken: slots.filter(el => el.classList.contains('taken')).map(el => el.textContent.trim()),
      free: slots.filter(el => !el.classList.contains('taken')).map(el => el.textContent.trim()),
    };
  });
  expect(result.taken, 'every 15-min slot inside the 09:00-09:45 appointment must be hidden, not just 09:00').toEqual(expect.arrayContaining(['09:00', '09:15', '09:30']));
  expect(result.free, 'the slot right at the appointment\'s end must still be selectable').toEqual(expect.arrayContaining(['09:45']));
});
