// Regression tests for the 24-question Gesundheitsfragebogen added to Anamnese
// (vendor/anamnese-shared.js) on explicit request: only Allgemeinmedizin and
// Kinderheilkunde get it, every other specialty (and the shared common section)
// stays untouched. Each question is a Ja/Nein <select> with its own conditional
// "Wenn ja, ...?" free-text field, hidden by default and only revealed once "Ja"
// is chosen -- both live (anGfbSync, onchange) and after loading an already-
// answered patient's saved data (anGfbSyncAll, called post-applyAnamneseData
// since that helper only ever sets .value, never a sibling field's visibility).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

// loadAnamneseForPatient() (vendor/kartei-anamnese.js) picks the specialty section by the
// PATIENT's own `fach` (falling back to this device's localStorage 'fachrichtung', then
// 'Allgemeinmedizin') -- not the currently logged-in doctor's fach. The seeded patient row
// needs `fach` set for these tests to actually exercise the specialty they're named after.
function seed(fach) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', fach, versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  };
}

async function setupDoctorPage(page, fach) {
  // extraInit runs via page.addInitScript() with no argument passed through (same
  // constraint noted in tests/patient-accounts-cross-tenant-cache.spec.js), so the
  // per-test `fach` (not static) has to be inlined into the generated function's
  // source via new Function() instead of closed over.
  // eslint-disable-next-line no-new-func
  const extraInit = new Function(`
    sessionStorage.setItem('smartordi_user', JSON.stringify({role:'arzt',name:'Dr. Sarah Ahmed',username:'dr.ahmed',isAdmin:true}));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({'dr.ahmed':{username:'dr.ahmed',fullName:'Dr. Sarah Ahmed',role:'arzt',isAdmin:true,fach:${JSON.stringify(fach)}}}));
  `);
  await installMockSupabase(page, seed(fach), extraInit);
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await patientsReady; });
  await page.evaluate(() => {
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    switchKarteiTab('anamnese', document.querySelector('.kartei-tab[onclick*="anamnese"]'));
  });
}

for (const fach of ['Allgemeinmedizin', 'Kinderheilkunde']) {
  test(`${fach}: Gesundheitsfragebogen renders with 24 Nein-by-default questions, "Wenn ja" fields hidden`, async ({ page }) => {
    await setupDoctorPage(page, fach);
    const counts = await page.evaluate(() => {
      const root = document.getElementById('anamnese-collapse-body');
      const selects = [...root.querySelectorAll('.gfb-q select')];
      return {
        selectCount: selects.length,
        allDefaultNein: selects.every(s => s.value === 'Nein'),
        wennJaCount: root.querySelectorAll('.gfb-wennja').length,
        allHiddenByDefault: [...root.querySelectorAll('.gfb-wennja')].every(f => f.style.display === 'none'),
      };
    });
    expect(counts.selectCount).toBe(24);
    expect(counts.allDefaultNein).toBe(true);
    expect(counts.wennJaCount).toBe(16);
    expect(counts.allHiddenByDefault).toBe(true);
  });
}

test('other specialties (e.g. Kardiologie) do not get the Gesundheitsfragebogen', async ({ page }) => {
  await setupDoctorPage(page, 'Kardiologie');
  const gfbCount = await page.evaluate(() => document.getElementById('anamnese-collapse-body').querySelectorAll('.gfb-q').length);
  expect(gfbCount).toBe(0);
});

test('choosing "Ja" reveals the matching "Wenn ja" field live; switching back to "Nein" hides it again', async ({ page }) => {
  await setupDoctorPage(page, 'Allgemeinmedizin');
  const result = await page.evaluate(() => {
    const root = document.getElementById('anamnese-collapse-body');
    const select = root.querySelector('select[data-key="an.gfb.medikamente"]');
    const field = select.closest('.gfb-q').querySelector('.gfb-wennja');
    const beforeJa = field.style.display;
    select.value = 'Ja';
    select.dispatchEvent(new Event('change'));
    const afterJa = field.style.display;
    select.value = 'Nein';
    select.dispatchEvent(new Event('change'));
    const afterNein = field.style.display;
    return { beforeJa, afterJa, afterNein };
  });
  expect(result.beforeJa).toBe('none');
  expect(result.afterJa).toBe('block');
  expect(result.afterNein).toBe('none');
});

test('a saved "Ja" answer with detail text round-trips through save+reload with the detail field visible', async ({ page }) => {
  await setupDoctorPage(page, 'Allgemeinmedizin');
  const result = await page.evaluate(async () => {
    const root = document.getElementById('anamnese-collapse-body');
    const select = root.querySelector('select[data-key="an.gfb.allergie"]');
    select.value = 'Ja';
    select.dispatchEvent(new Event('change'));
    root.querySelector('input[data-key="an.gfb.allergie.detail"]').value = 'Penizillin, Pollen';
    await saveAnamnese();
    const saved = window.__store.patients.find(p => p.username === 'maria.huber').anamnese;

    // Simulate switching away to a different patient and back, the real path
    // that exercises loadAnamneseForPatient()'s reset + applyAnamneseData + anGfbSyncAll.
    loadAnamneseForPatient('Someone Else');
    loadAnamneseForPatient('Maria Huber');

    const selectAfter = root.querySelector('select[data-key="an.gfb.allergie"]');
    const fieldAfter = root.querySelector('input[data-key="an.gfb.allergie.detail"]');
    return {
      saved,
      selectValueAfterReload: selectAfter.value,
      fieldValueAfterReload: fieldAfter.value,
      fieldVisibleAfterReload: fieldAfter.style.display,
    };
  });
  expect(result.saved['an.gfb.allergie']).toBe('Ja');
  expect(result.saved['an.gfb.allergie.detail']).toBe('Penizillin, Pollen');
  expect(result.selectValueAfterReload).toBe('Ja');
  expect(result.fieldValueAfterReload).toBe('Penizillin, Pollen');
  expect(result.fieldVisibleAfterReload).toBe('block');
});

test('patient-facing first-login Anamnese screen (Allgemeinmedizin) also renders the Gesundheitsfragebogen and persists a "Ja" answer', async ({ page }) => {
  await installMockSupabase(page, {
    practice_settings: [{ id: true }],
    patients: [{
      id: 'p1', username: 'fatima', full_name: 'Fatima Mohammed', name: 'Fatima',
      fach: 'Allgemeinmedizin', join_status: 'approved', first_login: false, anamnese: null,
      versicherung: 'ÖGK', svnr: '1234567890', dob: '1990-05-12',
      // supabase/phase79_patient_login_consent.sql -- already consented
      // (unrelated to what this test covers) so doLogin() routes straight
      // to Anamnese, not the new login-time consent screen first.
      consent_given_at: '2026-01-01T00:00:00Z',
    }],
  }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  page.on('dialog', d => d.dismiss());
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    sb.auth.signInWithPassword = () => Promise.resolve({ data: { user: { id: 'auth-p1' } }, error: null });
    sb.rpc = (name, args) => {
      const p = window.__store.patients.find(x => x.id === 'p1');
      if (name === 'patient_login_precheck') return Promise.resolve({ data: 'p_p1@patients.smartordi.internal', error: null });
      if (name === 'patient_get_profile') return Promise.resolve({ data: [{ id: p.id, username: p.username, full_name: p.full_name, name: p.name, first_login: p.first_login, join_status: p.join_status, join_note: null, anamnese: p.anamnese, consent_given_at: p.consent_given_at }], error: null });
      if (name === 'patient_set_anamnese') { p.anamnese = args.p_data; return Promise.resolve({ data: true, error: null }); }
      if (name === 'check_join_request_status') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    };
  });

  await page.fill('#username', 'fatima');
  await page.fill('#password', 'demo123');
  await page.click('#loginBtn');
  await page.waitForTimeout(1000);

  const gfbCount = await page.evaluate(() => document.querySelectorAll('#anamneseForm .gfb-q').length);
  expect(gfbCount).toBe(24);

  const result = await page.evaluate(async () => {
    const select = document.querySelector('#anamneseForm select[data-key="an.gfb.rauchen"]');
    select.value = 'Ja';
    select.dispatchEvent(new Event('change'));
    document.querySelector('#anamneseForm input[data-key="an.gfb.rauchen.detail"]').value = '10 Zigaretten';
    await submitAnamnese();
    return window.__store.patients.find(p => p.id === 'p1').anamnese;
  });
  expect(result['an.gfb.rauchen']).toBe('Ja');
  expect(result['an.gfb.rauchen.detail']).toBe('10 Zigaretten');
});

// Regression tests for the "highlights" collapsed-bar line and the "Nur
// Ja-Antworten anzeigen" filter toggle (vendor/kartei-anamnese.js's
// updateAnamneseHighlightsLine()/applyGfbOnlyJaFilter(), vendor/anamnese-
// shared.js's collectGfbAuffaelligkeiten()) -- added so a doctor can spot
// what's actually flagged in a 24-question form without reading every row,
// the same difficulty real tomedo users report about their own version of
// this feature (see TODO.md). setupDoctorPage() above only switches to the
// tab; these tests need loadAnamneseForPatient() itself (the real path that
// populates saved answers and refreshes the highlights line).
function seedWithAnamnese(fach, anamnese) {
  const base = seed(fach);
  base.patients[0].anamnese = anamnese;
  return base;
}

test('the collapsed Anamnese bar shows a highlights line naming only the "Ja" answers, with their detail text', async ({ page }) => {
  const extraInit = () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  };
  await installMockSupabase(page, seedWithAnamnese('Allgemeinmedizin', {
    'an.gfb.diabetes': 'Ja',
    'an.gfb.allergie': 'Ja', 'an.gfb.allergie.detail': 'Penicillin',
    'an.gfb.epilepsie': 'Nein',
  }), extraInit);
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await patientsReady; });

  const text = await page.evaluate(() => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-clinic').classList.add('active');
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    switchKarteiTab('anamnese', document.querySelector('.kartei-tab[onclick*="anamnese"]'));
    loadAnamneseForPatient('Maria Huber');
    return document.getElementById('anamnese-highlights-line').textContent;
  });
  expect(text).toContain('2 Auffälligkeiten');
  expect(text).toContain('Diabetes mellitus');
  expect(text).toContain('Allergie');
  expect(text).toContain('Penicillin');
  expect(text).not.toContain('Epilepsie');
});

test('a submitted Anamnese with zero "Ja" answers shows a reassuring "keine Auffälligkeiten" line, not nothing', async ({ page }) => {
  const extraInit = () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  };
  await installMockSupabase(page, seedWithAnamnese('Allgemeinmedizin', { 'an.gfb.diabetes': 'Nein' }), extraInit);
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await patientsReady; });

  const result = await page.evaluate(() => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-clinic').classList.add('active');
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    switchKarteiTab('anamnese', document.querySelector('.kartei-tab[onclick*="anamnese"]'));
    loadAnamneseForPatient('Maria Huber');
    const el = document.getElementById('anamnese-highlights-line');
    return { text: el.textContent, visible: el.style.display !== 'none' };
  });
  expect(result.visible).toBe(true);
  expect(result.text).toContain('Keine Auffälligkeiten');
});

test('a patient who never submitted an Anamnese, or a specialty without the Gesundheitsfragebogen, shows no highlights line at all', async ({ page }) => {
  await setupDoctorPage(page, 'Allgemeinmedizin');
  const noSubmission = await page.evaluate(() => {
    loadAnamneseForPatient('Maria Huber'); // seed() never sets .anamnese
    const el = document.getElementById('anamnese-highlights-line');
    return { text: el.textContent, visible: el.style.display !== 'none' };
  });
  expect(noSubmission.visible).toBe(false);
  expect(noSubmission.text).toBe('');

  const extraInit = () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  };
  // A specialty without the Gesundheitsfragebogen, but WITH a real submitted
  // Anamnese -- isolates the "no .gfb-q rows exist" guard from the "never
  // submitted" one above (both must independently suppress the line).
  await installMockSupabase(page, seedWithAnamnese('Kardiologie', { 'an.common.medikamente': 'Aspirin' }), extraInit);
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await patientsReady; });
  const noGfb = await page.evaluate(() => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-clinic').classList.add('active');
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    switchKarteiTab('anamnese', document.querySelector('.kartei-tab[onclick*="anamnese"]'));
    loadAnamneseForPatient('Maria Huber');
    const el = document.getElementById('anamnese-highlights-line');
    return { visible: el.style.display !== 'none' };
  });
  expect(noGfb.visible).toBe(false);
});

test('"Nur Ja-Antworten anzeigen" hides every "Nein" row and stays live if an answer changes while it\'s on', async ({ page }) => {
  await setupDoctorPage(page, 'Allgemeinmedizin');
  const result = await page.evaluate(() => {
    loadAnamneseForPatient('Maria Huber');
    const root = document.getElementById('anamnese-collapse-body');
    root.querySelector('select[data-key="an.gfb.diabetes"]').value = 'Ja';

    const toggle = document.getElementById('gfbOnlyJaToggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const visibleAfterFilter = [...root.querySelectorAll('.gfb-q')].filter(q => q.style.display !== 'none').length;
    const hiddenAfterFilter = [...root.querySelectorAll('.gfb-q')].filter(q => q.style.display === 'none').length;

    // Flip a second question to "Ja" live while the filter is still on --
    // it must appear immediately, not just after re-toggling the filter.
    const epilepsy = root.querySelector('select[data-key="an.gfb.epilepsie"]');
    epilepsy.value = 'Ja';
    epilepsy.dispatchEvent(new Event('change', { bubbles: true }));
    const epilepsyRowVisible = epilepsy.closest('.gfb-q').style.display !== 'none';

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const allVisibleAfterTurningOff = [...root.querySelectorAll('.gfb-q')].every(q => q.style.display !== 'none');

    return { visibleAfterFilter, hiddenAfterFilter, epilepsyRowVisible, allVisibleAfterTurningOff };
  });
  expect(result.visibleAfterFilter).toBe(1);
  expect(result.hiddenAfterFilter).toBe(23);
  expect(result.epilepsyRowVisible).toBe(true);
  expect(result.allVisibleAfterTurningOff).toBe(true);
});
