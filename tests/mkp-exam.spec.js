// Regression test for the MKP (Mutter-Kind-Pass) exam logic in doctor.html
// -- mkpStatusFor()'s Fällig/Noch nicht fällig/Erledigt status and
// mkpSaveCurrentExam()'s upsert-not-duplicate behavior had no test
// coverage, despite supabase/phase4_mkp_untersuchungen.sql's whole point
// being that saving the same exam again completes/overwrites it rather
// than creating a second row.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function setupPage(page) {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'baby.test', full_name: 'Baby Test', name: 'Baby', versicherung: 'ÖGK', svnr: '123', dob: daysAgo(60), join_status: 'approved' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1000);
}

test('mkpStatusFor() reports Fällig once the exam\'s age threshold is reached, Noch nicht fällig before it, and Erledigt once completed', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(() => {
    const exam = MKP_EXAMS.find(e => e.key === 'lw4_7_allgemein'); // minDay: 28
    return {
      tooYoung: mkpStatusFor(exam, null, 10),
      due: mkpStatusFor(exam, null, 40),
      done: mkpStatusFor(exam, { completed_at: new Date().toISOString() }, 10),
    };
  });
  expect(result.tooYoung.label).toBe('Noch nicht fällig');
  expect(result.due.label).toBe('Fällig');
  expect(result.done.label, 'a completed exam is always "Erledigt", even if still technically too young').toBe('Erledigt');
});

test('mkpSaveCurrentExam() persists the entered field values and marks the exam completed', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(async () => {
    switchView('clinic'); toggleKartei();
    document.getElementById('kartei-name').textContent = 'Baby Test';
    switchKarteiTab('mkp');
    await renderKarteiMkp();
    mkpOpenExam('lw4_7_allgemein');
  });
  const result = await page.evaluate(async () => {
    document.getElementById('mkp-lw4_7_allgemein-gewicht').value = '4200';
    document.querySelector('input[name="mkp-lw4_7_allgemein-stillen"][value="ja"]').checked = true;
    await mkpSaveCurrentExam();
    await new Promise(r => setTimeout(r, 100));
    return window.__store.mkp_untersuchungen[0];
  });
  expect(result.patient_id).toBe('p1');
  expect(result.exam_key).toBe('lw4_7_allgemein');
  expect(result.data.gewicht).toBe(4200);
  expect(result.data.stillen).toBe('ja');
  expect(result.completed_at).toBeTruthy();
  expect(result.uploaded_by).toBe('dr.ahmed');
});

test('saving the same exam twice updates the one record instead of creating a duplicate', async ({ page }) => {
  await setupPage(page);
  await page.evaluate(async () => {
    switchView('clinic'); toggleKartei();
    document.getElementById('kartei-name').textContent = 'Baby Test';
    switchKarteiTab('mkp');
    await renderKarteiMkp();
  });
  const firstSave = await page.evaluate(async () => {
    mkpOpenExam('lw4_7_allgemein');
    document.getElementById('mkp-lw4_7_allgemein-gewicht').value = '4000';
    await mkpSaveCurrentExam();
    await new Promise(r => setTimeout(r, 100));
    return window.__store.mkp_untersuchungen.length;
  });
  const secondSave = await page.evaluate(async () => {
    mkpOpenExam('lw4_7_allgemein');
    document.getElementById('mkp-lw4_7_allgemein-gewicht').value = '4300';
    await mkpSaveCurrentExam();
    await new Promise(r => setTimeout(r, 100));
    return { rows: window.__store.mkp_untersuchungen.length, gewicht: window.__store.mkp_untersuchungen[0].data.gewicht };
  });
  expect(firstSave).toBe(1);
  expect(secondSave.rows, 'the second save must update the existing row, not add a second one').toBe(1);
  expect(secondSave.gewicht).toBe(4300);
});
