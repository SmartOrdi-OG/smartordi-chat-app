// Regression test for supabase/phase29_practice_working_hours.sql: letting
// the secretary configure real practice opening days/hours (Öffnungszeiten)
// instead of every practice being stuck with one hardcoded Mon-Fri
// 08:00-11:30/14:00-16:00 schedule, and having that configuration actually
// drive which slots/days are offered when booking a new appointment --
// for the secretary (secretary.html) and for a patient booking themselves
// (patient.html).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  }, extra);
}

test('openWorkingHoursModal() shows the fallback default schedule when nothing is configured yet', async ({ page }) => {
  await installMockSupabase(page, seed({ practices: [{ id: 'prac1', name: 'Test Praxis' }] }), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);

  const fields = await page.evaluate(() => {
    openWorkingHoursModal();
    return {
      monOpen: document.getElementById('wh-mon-open').checked,
      monB1: [document.getElementById('wh-mon-b1s').value, document.getElementById('wh-mon-b1e').value],
      monB2: [document.getElementById('wh-mon-b2s').value, document.getElementById('wh-mon-b2e').value],
      satOpen: document.getElementById('wh-sat-open').checked,
      satFieldsDisabled: document.getElementById('wh-sat-b1s').disabled,
    };
  });
  expect(fields.monOpen).toBe(true);
  expect(fields.monB1).toEqual(['08:00', '11:30']);
  expect(fields.monB2).toEqual(['14:00', '16:00']);
  expect(fields.satOpen).toBe(false);
  expect(fields.satFieldsDisabled, 'a closed day\'s time fields should be disabled').toBe(true);
});

test('saveWorkingHours() persists the edited schedule to the practices row', async ({ page }) => {
  await installMockSupabase(page, seed({ practices: [{ id: 'prac1', name: 'Test Praxis' }] }), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    openWorkingHoursModal();
    // Close Monday, open Saturday morning only.
    document.getElementById('wh-mon-open').checked = false;
    document.getElementById('wh-sat-open').checked = true;
    document.getElementById('wh-sat-b1on').checked = true;
    document.getElementById('wh-sat-b1s').value = '09:00';
    document.getElementById('wh-sat-b1e').value = '12:00';
    await saveWorkingHours();
    return {
      toast: document.getElementById('toast')?.textContent || '',
      saved: window.__store.practices[0].working_hours,
      liveGetter: getWorkingHours(),
    };
  });
  expect(result.toast).toContain('gespeichert');
  expect(result.saved.mon.open).toBe(false);
  expect(result.saved.sat).toEqual({ open: true, blocks: [['09:00', '12:00']] });
  expect(result.liveGetter.sat.open, 'getWorkingHours() must reflect the just-saved value immediately').toBe(true);
});

// Regression test for a real reported bug: a day with only a morning
// schedule saved successfully, but on some devices/browsers an untouched
// <input type="time"> renders as "00:00" (indistinguishable from a real
// value) instead of empty -- if the second (optional) time range's fields
// are simply left enabled alongside the first, a stray "00:00" can end up
// in its "Von" field with "Bis" still blank, and it looked like a second
// work block was required. The second range now only exists when its own
// "+ Pause/2. Zeitraum" checkbox is on; a stray value in its fields while
// that checkbox is off must be completely ignored, not block the save.
test('a day with only one time range saves cleanly even if the (unchecked) second range has a stray leftover value', async ({ page }) => {
  await installMockSupabase(page, seed({ practices: [{ id: 'prac1', name: 'Test Praxis' }] }), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    openWorkingHoursModal();
    // Mittwoch: only a single morning range is wanted.
    document.getElementById('wh-wed-b1s').value = '08:00';
    document.getElementById('wh-wed-b1e').value = '11:30';
    // Wednesday's default schedule has a second (afternoon) range, so its
    // "+ Pause/2. Zeitraum" checkbox starts checked -- the secretary
    // unchecks it (no longer wants an afternoon range), but the field
    // still carries a stray "00:00" left over (the exact browser quirk
    // reported: an emptied/untouched <input type="time"> can render as
    // "00:00" instead of blank), with "Bis" left blank.
    document.getElementById('wh-wed-b2on').checked = false;
    document.getElementById('wh-wed-b2s').value = '00:00';
    const b2onCheckedBeforeSave = document.getElementById('wh-wed-b2on').checked;
    await saveWorkingHours();
    return {
      b2onCheckedBeforeSave,
      toast: document.getElementById('toast')?.textContent || '',
      wed: window.__store.practices[0].working_hours.wed,
    };
  });
  expect(result.b2onCheckedBeforeSave, 'the second range must default to off, not silently active').toBe(false);
  expect(result.toast).toContain('gespeichert');
  expect(result.wed).toEqual({ open: true, blocks: [['08:00', '11:30']] });
});

// Regression test for a second, related real bug: range 1 had no opt-out at
// all (unlike range 2), so a doctor who only works evenings on a given day
// -- no morning session -- had no way to represent that. Range 1's fields
// also default-rendered as "00:00" when untouched, so leaving it "on" with
// no real values entered a bogus 00:00-00:00 block and blocked the save
// with "Bis muss nach Von liegen". Both ranges are now equally optional.
test('a day can be configured as evening-only, with range 1 unchecked entirely', async ({ page }) => {
  await installMockSupabase(page, seed({ practices: [{ id: 'prac1', name: 'Test Praxis' }] }), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    openWorkingHoursModal();
    // Mittwoch: doctor only works in the evening -- no morning session at
    // all. Range 1 stays unchecked despite carrying stray "00:00" values
    // (the exact browser quirk reported), range 2 is the only real range.
    document.getElementById('wh-wed-b1on').checked = false;
    document.getElementById('wh-wed-b1s').value = '00:00';
    document.getElementById('wh-wed-b1e').value = '00:00';
    document.getElementById('wh-wed-b2on').checked = true;
    document.getElementById('wh-wed-b2s').value = '18:00';
    document.getElementById('wh-wed-b2e').value = '21:00';
    await saveWorkingHours();
    return {
      toast: document.getElementById('toast')?.textContent || '',
      wed: window.__store.practices[0].working_hours.wed,
    };
  });
  expect(result.toast).toContain('gespeichert');
  expect(result.wed).toEqual({ open: true, blocks: [['18:00', '21:00']] });
});

test('the Uhrzeit list respects a custom schedule: closed on the configured date, open with the configured block on another', async ({ page }) => {
  await installMockSupabase(page, seed({
    practices: [{ id: 'prac1', name: 'Test Praxis', working_hours: {
      mon: { open: false, blocks: [] },
      tue: { open: true, blocks: [['09:00', '12:00']] },
      wed: { open: true, blocks: [['08:00', '11:30'], ['14:00', '16:00']] },
      thu: { open: true, blocks: [['08:00', '11:30'], ['14:00', '16:00']] },
      fri: { open: true, blocks: [['08:00', '11:30'], ['14:00', '16:00']] },
      sat: { open: false, blocks: [] },
      sun: { open: false, blocks: [] },
    } }],
  }), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);

  const result = await page.evaluate(() => {
    openNewTerminModal();
    document.getElementById('ntArzt').value = 'u1';
    document.getElementById('newTerminDate').value = '2026-08-17'; // a Monday -- configured closed
    refreshTermineSlotOptions(NT_SLOT_IDS);
    const monday = [...document.getElementById('ntTime').options].map(o => o.value);
    document.getElementById('newTerminDate').value = '2026-08-18'; // Tuesday -- configured 09:00-12:00 only
    refreshTermineSlotOptions(NT_SLOT_IDS);
    const tuesday = [...document.getElementById('ntTime').options].map(o => o.value);
    return { monday, tuesday };
  });
  expect(result.monday, 'a day configured closed must offer no bookable start times').toEqual(['']);
  expect(result.tuesday, 'a day with a custom single block must only offer slots inside it').toEqual(
    expect.arrayContaining(['09:00', '09:15', '11:45'])
  );
  expect(result.tuesday).not.toEqual(expect.arrayContaining(['08:00', '14:00']));
});

test('patient.html: a closed calendar day is not clickable, and an open day only offers its configured slots', async ({ page }) => {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [{ id: 'p1', username: 'maria', name: 'Maria', full_name: 'Maria Huber', dob: '1985-01-01' }], error: null });
      if (name === 'patient_get_termine') return Promise.resolve({ data: [], error: null });
      if (name === 'patient_get_working_hours') return Promise.resolve({ data: {
        mon: { open: false, blocks: [] },
        tue: { open: true, blocks: [['09:00', '10:00']] },
        wed: { open: false, blocks: [] }, thu: { open: false, blocks: [] },
        fri: { open: false, blocks: [] }, sat: { open: false, blocks: [] }, sun: { open: false, blocks: [] },
      }, error: null });
      return Promise.resolve({ data: [], error: null });
    };
  });
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    currentDate = new Date(2026, 7, 1); // August 2026
    selectedArzt = 'dr.ahmed';
    renderCalendar();
    selectDay(18); // 2026-08-18 is a Tuesday -- configured open 09:00-10:00
    const tueSlots = [...document.querySelectorAll('#timeSlots .time-slot')].map(el => el.textContent.trim());
    const mondayCell = [...document.querySelectorAll('#calGrid .cal-day')].find(el => el.textContent.trim() === '17');
    return { tueSlots, mondayClosed: mondayCell.classList.contains('closed'), mondayHasOnclick: !!mondayCell.onclick };
  });
  expect(result.tueSlots).toEqual(['09:00', '09:15', '09:30', '09:45', '10:00']);
  expect(result.mondayClosed, '2026-08-17 (Monday) is configured closed').toBe(true);
  expect(result.mondayHasOnclick, 'a closed day must not be clickable').toBe(false);
});
