// Regression test for a performance-audit finding: renderPatientList()
// (doctor.html) / renderRealPatientRows() (secretary.html) rebuild the
// ENTIRE patient list's DOM on every single patient_messages realtime
// event -- in a busy multi-staff practice, several patients messaging
// around the same time used to trigger one full rebuild PER message. Both
// call sites now go through debounce() (vendor/patient-data.js), so a burst
// of events within the debounce window collapses into a single render.
// Verified here via a MutationObserver rather than by asserting an exact
// mutation count (an implementation detail of each render function) --
// a burst of 3 rapid events must cause NO MORE DOM churn than a single
// event alone.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  };
}

async function measureMutationsFor(page, times) {
  return await page.evaluate(async (n) => {
    const list = document.getElementById('patientList');
    let mutations = 0;
    const observer = new MutationObserver((records) => { mutations += records.length; });
    observer.observe(list, { childList: true, subtree: true });
    for (let i = 0; i < n; i++) {
      await window.__realtimeHandlers['patient-messages-changes']();
    }
    // Comfortably past the 200ms debounce window used at both call sites.
    await new Promise((r) => setTimeout(r, 450));
    observer.disconnect();
    return mutations;
  }, times);
}

test('doctor.html: a burst of realtime message events collapses into a single patient-list re-render', async ({ page }) => {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, allMessagesReady]); });

  const forOne = await measureMutationsFor(page, 1);
  const forThree = await measureMutationsFor(page, 3);
  expect(forOne, 'sanity check: a single realtime event must still actually trigger a render').toBeGreaterThan(0);
  expect(forThree, 'a burst of 3 rapid events must not cause more DOM churn than a single event').toBe(forOne);
});

test('secretary.html: a burst of realtime message events collapses into a single patient-list re-render', async ({ page }) => {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, allMessagesReady]); });

  const forOne = await measureMutationsFor(page, 1);
  const forThree = await measureMutationsFor(page, 3);
  expect(forOne, 'sanity check: a single realtime event must still actually trigger a render').toBeGreaterThan(0);
  expect(forThree, 'a burst of 3 rapid events must not cause more DOM churn than a single event').toBe(forOne);
});

test('debounce() itself collapses several synchronous calls into exactly one invocation', async ({ page }) => {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);

  const calls = await page.evaluate(async () => {
    let n = 0;
    const debounced = debounce(() => { n++; }, 50);
    debounced(); debounced(); debounced();
    await new Promise((r) => setTimeout(r, 150));
    return n;
  });
  expect(calls).toBe(1);
});
