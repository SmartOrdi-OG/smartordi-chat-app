// Real user request (2026-08-17): the secretary/doctor had no way to know
// WHY a patient booked an appointment beyond a free-text symptom note --
// patient.html's own booking flow always sent art:'Ordination' regardless
// of what the patient actually needed (e.g. "Arbeitsunfähigkeitsmeldung"/
// Krankmeldung, "Pflegefreistellung", or just a routine "Kontrolle"). A new
// "Grund des Besuchs" select (#terminArt) lets the patient pick a real
// reason at booking time -- the same `termine.art` column/free-text value
// secretary.html's own booking forms already write and display, so no
// staff-side wiring was needed at all (see secretary.html's Termine list
// card, which already renders t.art verbatim for any staff-booked Termin).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function setupPatient(page, extraRpc) {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  await page.evaluate((extra) => {
    sb.rpc = (name, args) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [{ id: 'p1', username: 'maria', name: 'Maria', full_name: 'Maria Huber', dob: '1985-01-01', first_login: false }], error: null });
      if (name === 'patient_get_termine') return Promise.resolve({ data: [], error: null });
      if (name === 'patient_get_working_hours') return Promise.resolve({ data: null, error: null });
      if (extra && extra.rpcName && name === extra.rpcName) { window.__rpcArgs = args; return Promise.resolve(extra.result); }
      return Promise.resolve({ data: [], error: null });
    };
  }, extraRpc || null);
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);
}

// Real user request (2026-08-17): choosing a reason must be a real, active
// choice, not a silent default -- the select now starts on an empty
// placeholder, and bookTermin() refuses to book at all until a real value
// is picked (same "chooseDay/chooseArzt/chooseSlot" validation pattern
// already used for the other required booking fields).
test('patient.html: the booking card has a Grund-des-Besuchs select defaulting to an empty placeholder (not silently Ordination), with both new certificate options present', async ({ page }) => {
  await setupPatient(page);
  const state = await page.evaluate(() => {
    const sel = document.getElementById('terminArt');
    return {
      defaultValue: sel.value,
      values: [...sel.options].map(o => o.value),
    };
  });
  expect(state.defaultValue).toBe('');
  expect(state.values).toEqual([
    '', 'Ordination', 'Kontrolle', 'Erstgespräch', 'Impfung', 'Blutabnahme',
    'Arbeitsunfähigkeitsmeldung', 'Pflegefreistellung', 'Sonstige',
  ]);
});

test('patient.html: booking is refused (no RPC call, error toast) if no Grund was actively chosen', async ({ page }) => {
  await setupPatient(page, {
    rpcName: 'patient_book_termin',
    result: { data: null, error: { message: 'should not be called' } },
  });
  await page.evaluate(() => {
    selectedDay = 1; currentDate = new Date('2026-09-01'); selectedArzt = 'u1'; selectedSlot = '09:00';
    // #terminArt deliberately left on its empty placeholder.
  });
  await page.evaluate(async () => { await bookTermin(); });
  const rpcCalled = await page.evaluate(() => window.__rpcArgs !== undefined);
  expect(rpcCalled).toBe(false);
  await expect(page.locator('#toast')).toHaveText('Bitte einen Grund für den Besuch wählen');
});

test('patient.html: booking with a chosen Grund (Pflegefreistellung) sends that exact value to patient_book_termin, not the old hardcoded Ordination', async ({ page }) => {
  await setupPatient(page, {
    rpcName: 'patient_book_termin',
    result: { data: { id: 't1', patient_name: 'Maria Huber', art: 'Pflegefreistellung', date: '2026-09-01', time: '09:00', end_time: '09:20', status: 'neu', arzt_id: 'u1' }, error: null },
  });
  await page.evaluate(() => {
    document.getElementById('terminArt').value = 'Pflegefreistellung';
    selectedDay = 1; currentDate = new Date('2026-09-01'); selectedArzt = 'u1'; selectedSlot = '09:00';
  });
  await page.evaluate(async () => { await bookTermin(); });
  const sentArt = await page.evaluate(() => window.__rpcArgs && window.__rpcArgs.p_art);
  expect(sentArt).toBe('Pflegefreistellung');
});

test('patient.html: booking with Arbeitsunfähigkeitsmeldung (Krankmeldung) also sends that value through', async ({ page }) => {
  await setupPatient(page, {
    rpcName: 'patient_book_termin',
    result: { data: { id: 't2', patient_name: 'Maria Huber', art: 'Arbeitsunfähigkeitsmeldung', date: '2026-09-01', time: '10:00', end_time: '10:20', status: 'neu', arzt_id: 'u1' }, error: null },
  });
  await page.evaluate(() => {
    document.getElementById('terminArt').value = 'Arbeitsunfähigkeitsmeldung';
    selectedDay = 1; currentDate = new Date('2026-09-01'); selectedArzt = 'u1'; selectedSlot = '10:00';
  });
  await page.evaluate(async () => { await bookTermin(); });
  const sentArt = await page.evaluate(() => window.__rpcArgs && window.__rpcArgs.p_art);
  expect(sentArt).toBe('Arbeitsunfähigkeitsmeldung');
});

test('patient.html: the demo/local booking path (no patient token) also respects the selected Grund', async ({ page }) => {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria' }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({
      maria: { fullName: 'Maria Huber', name: 'Maria', role: 'patient', dob: '1985-01-01', messages: [] },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.getElementById('terminArt').value = 'Kontrolle';
    selectedDay = 1; currentDate = new Date('2026-09-01'); selectedArzt = 'dr.ahmed'; selectedSlot = '09:00';
  });
  await page.evaluate(async () => { await bookTermin(); });
  const created = await page.evaluate(() => loadTermine().find(t => t.date === '2026-09-01' && t.time === '09:00'));
  expect(created).toBeTruthy();
  expect(created.art).toBe('Kontrolle');
});

// Real user feedback (2026-08-17, after trying it live): the symptom
// picker ("Grund für den Besuch" body figure) popped up right after every
// single booking, including a Pflegefreistellung/Krankmeldung -- makes no
// sense for an administrative certificate request. Now gated by
// artNeedsSymptomPicker() -- only Ordination/Kontrolle/Erstgespräch/
// Sonstige still auto-open it.
test('patient.html: booking a Krankmeldung (Arbeitsunfähigkeitsmeldung) does NOT auto-open the symptom picker', async ({ page }) => {
  await setupPatient(page, {
    rpcName: 'patient_book_termin',
    result: { data: { id: 't3', patient_name: 'Maria Huber', art: 'Arbeitsunfähigkeitsmeldung', date: '2026-09-01', time: '09:00', end_time: '09:20', status: 'neu', arzt_id: 'u1' }, error: null },
  });
  await page.evaluate(() => {
    document.getElementById('terminArt').value = 'Arbeitsunfähigkeitsmeldung';
    selectedDay = 1; currentDate = new Date('2026-09-01'); selectedArzt = 'u1'; selectedSlot = '09:00';
  });
  await page.evaluate(async () => { await bookTermin(); });
  const modalShown = await page.evaluate(() => document.getElementById('symptomModal').classList.contains('show'));
  expect(modalShown).toBe(false);
});

test('patient.html: booking a Pflegefreistellung does NOT auto-open the symptom picker either', async ({ page }) => {
  await setupPatient(page, {
    rpcName: 'patient_book_termin',
    result: { data: { id: 't4', patient_name: 'Maria Huber', art: 'Pflegefreistellung', date: '2026-09-01', time: '09:00', end_time: '09:20', status: 'neu', arzt_id: 'u1' }, error: null },
  });
  await page.evaluate(() => {
    document.getElementById('terminArt').value = 'Pflegefreistellung';
    selectedDay = 1; currentDate = new Date('2026-09-01'); selectedArzt = 'u1'; selectedSlot = '09:00';
  });
  await page.evaluate(async () => { await bookTermin(); });
  const modalShown = await page.evaluate(() => document.getElementById('symptomModal').classList.contains('show'));
  expect(modalShown).toBe(false);
});

test('patient.html: booking an Impfung/Blutabnahme also skips the symptom picker', async ({ page }) => {
  await setupPatient(page, {
    rpcName: 'patient_book_termin',
    result: { data: { id: 't5', patient_name: 'Maria Huber', art: 'Impfung', date: '2026-09-01', time: '09:00', end_time: '09:20', status: 'neu', arzt_id: 'u1' }, error: null },
  });
  await page.evaluate(() => {
    document.getElementById('terminArt').value = 'Impfung';
    selectedDay = 1; currentDate = new Date('2026-09-01'); selectedArzt = 'u1'; selectedSlot = '09:00';
  });
  await page.evaluate(async () => { await bookTermin(); });
  const modalShown = await page.evaluate(() => document.getElementById('symptomModal').classList.contains('show'));
  expect(modalShown).toBe(false);
});

test('patient.html: booking a plain Kontrolle/Ordination visit still auto-opens the symptom picker as before', async ({ page }) => {
  await setupPatient(page, {
    rpcName: 'patient_book_termin',
    result: { data: { id: 't6', patient_name: 'Maria Huber', art: 'Kontrolle', date: '2026-09-01', time: '09:00', end_time: '09:20', status: 'neu', arzt_id: 'u1' }, error: null },
  });
  await page.evaluate(() => {
    document.getElementById('terminArt').value = 'Kontrolle';
    selectedDay = 1; currentDate = new Date('2026-09-01'); selectedArzt = 'u1'; selectedSlot = '09:00';
  });
  await page.evaluate(async () => { await bookTermin(); });
  const modalShown = await page.evaluate(() => document.getElementById('symptomModal').classList.contains('show'));
  expect(modalShown).toBe(true);
});

test('secretary.html: both "Art des Termins" booking dropdowns include the new Arbeitsunfähigkeitsmeldung/Pflegefreistellung options', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);
  const state = await page.evaluate(() => ({
    ntArt: [...document.getElementById('ntArt').options].map(o => o.value),
    pdArt: [...document.getElementById('pd-termin-art').options].map(o => o.value),
  }));
  expect(state.ntArt).toContain('Arbeitsunfähigkeitsmeldung');
  expect(state.ntArt).toContain('Pflegefreistellung');
  expect(state.pdArt).toContain('Arbeitsunfähigkeitsmeldung');
  expect(state.pdArt).toContain('Pflegefreistellung');
});
