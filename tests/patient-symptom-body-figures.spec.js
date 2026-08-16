// Real user request (2026-08-14, with a reference "pain infographic" stock
// image for proportions/style only, not reproduced): the symptom picker's
// single generic body figure is now three body types (adult male, adult
// female, child), each with front + back views, still built from
// clickable SVG regions -- vendor/symptom-body-figures.js. A patient
// account gets a Mann/Frau toggle; a child account skips it entirely and
// always gets the child figure.
//
// Extended 2026-08-16 (supabase/phase72_patient_geschlecht.sql): a real
// geschlecht field now exists on the patient record, so openSymptomModal()
// auto-selects the matching figure from it every time the picker opens --
// the toggle stays as the in-session override/fallback for an unset/'d'
// value. See geschlechtToBodyVariant()/openSymptomModal() in patient.html.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function profileRow(overrides) {
  return Object.assign({
    id: 'p1', username: 'maria.huber', name: 'Maria', full_name: 'Maria Huber',
    fach: null, dob: '1985-01-01', adresse: 'Addr 1', tel: '+43 1', email: 'm@h.at',
    versicherung: 'ÖGK', svnr: 'SVNR1', first_login: false,
  }, overrides || {});
}

async function setup(page, profile) {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria.huber' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  await page.evaluate((row) => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [row], error: null });
      if (name === 'patient_get_termine') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    };
  }, profile || profileRow());
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);
}

test('an adult account defaults to the male figure, with a Mann/Frau toggle visible', async ({ page }) => {
  await setup(page, profileRow({ is_child: false }));
  await page.evaluate(() => openSymptomModal(null));
  const state = await page.evaluate(() => ({
    toggleVisible: getComputedStyle(document.getElementById('bodyGenderToggle')).display !== 'none',
    frontHtml: document.getElementById('bodyFrontView').innerHTML,
    maleActive: document.getElementById('bodyGenderMaleBtn').classList.contains('active'),
  }));
  expect(state.toggleVisible).toBe(true);
  expect(state.maleActive).toBe(true);
  expect(state.frontHtml).toContain('data-region="kopf"');
  expect(state.frontHtml.length).toBeGreaterThan(0);
});

test('switching to the female figure re-renders both views and keeps a region selection intact', async ({ page }) => {
  await setup(page, profileRow({ is_child: false }));
  await page.evaluate(() => openSymptomModal(null));
  await page.evaluate(() => toggleRegion('bauch'));
  const before = await page.evaluate(() => document.querySelector('[data-region="bauch"]').classList.contains('active'));
  expect(before).toBe(true);

  await page.evaluate(() => setBodyGenderVariant('female'));
  const state = await page.evaluate(() => ({
    femaleActive: document.getElementById('bodyGenderFemaleBtn').classList.contains('active'),
    bauchStillActive: document.querySelector('[data-region="bauch"]').classList.contains('active'),
    activeRegionsHasIt: [...activeRegions].includes('bauch'),
  }));
  expect(state.femaleActive).toBe(true);
  expect(state.bauchStillActive, 'switching figures mid-pick must not lose the already-selected region').toBe(true);
  expect(state.activeRegionsHasIt).toBe(true);
});

test('a child account never shows the Mann/Frau toggle and always gets the child figure', async ({ page }) => {
  await setup(page, profileRow({ is_child: true, dob: '2020-01-01' }));
  await page.evaluate(() => openSymptomModal(null));
  const state = await page.evaluate(() => ({
    toggleVisible: getComputedStyle(document.getElementById('bodyGenderToggle')).display !== 'none',
    viewBox: document.getElementById('bodyFrontView').getAttribute('viewBox'),
  }));
  expect(state.toggleVisible, 'a child account has no adult figure to choose between').toBe(false);
  // The child figure uses its own (shorter) viewBox -- see
  // vendor/symptom-body-figures.js's own comment on why.
  expect(state.viewBox).toBe('0 0 200 250');
});

test('front/back toggle still works correctly for every figure variant (male/female/child)', async ({ page }) => {
  await setup(page, profileRow({ is_child: false }));
  await page.evaluate(() => openSymptomModal(null));
  for (const variant of ['male', 'female']) {
    await page.evaluate((v) => setBodyGenderVariant(v), variant);
    const frontVisibleBefore = await page.evaluate(() => getComputedStyle(document.getElementById('bodyFrontView')).display !== 'none');
    expect(frontVisibleBefore, variant + ': starts on front view').toBe(true);
    await page.evaluate(() => toggleBodyView());
    const state = await page.evaluate(() => ({
      frontVisible: getComputedStyle(document.getElementById('bodyFrontView')).display !== 'none',
      backVisible: getComputedStyle(document.getElementById('bodyBackView')).display !== 'none',
      backHtml: document.getElementById('bodyBackView').innerHTML,
    }));
    expect(state.frontVisible, variant + ': front hidden after toggle').toBe(false);
    expect(state.backVisible, variant + ': back shown after toggle').toBe(true);
    expect(state.backHtml).toContain('data-region="ruecken"');
    await page.evaluate(() => toggleBodyView());
  }
});

// Clicking any region on any figure variant must still tag the exact same
// canonical SYMPTOM_REGIONS key the doctor's side reads -- the figure
// changed, the underlying data model (unchanged from before) did not.
test('clicking a region on the female figure still records the canonical region key and its real symptom list', async ({ page }) => {
  await setup(page, profileRow({ is_child: false }));
  await page.evaluate(() => openSymptomModal(null));
  await page.evaluate(() => setBodyGenderVariant('female'));
  await page.evaluate(() => toggleRegion('brust'));
  const html = await page.evaluate(() => document.getElementById('symptomRegions').innerHTML);
  expect(html).toContain('Brustschmerzen');
  expect(html).toContain('Herzrasen');
});

// ── supabase/phase72_patient_geschlecht.sql: auto-selection from the
// patient's own real registered gender ──

test('an account with geschlecht=w gets the female figure pre-selected on open, no manual toggle needed', async ({ page }) => {
  await setup(page, profileRow({ is_child: false, geschlecht: 'w' }));
  await page.evaluate(() => openSymptomModal(null));
  const state = await page.evaluate(() => ({
    femaleActive: document.getElementById('bodyGenderFemaleBtn').classList.contains('active'),
    maleActive: document.getElementById('bodyGenderMaleBtn').classList.contains('active'),
  }));
  expect(state.femaleActive).toBe(true);
  expect(state.maleActive).toBe(false);
});

test('an account with geschlecht=m gets the male figure pre-selected on open', async ({ page }) => {
  await setup(page, profileRow({ is_child: false, geschlecht: 'm' }));
  await page.evaluate(() => openSymptomModal(null));
  const state = await page.evaluate(() => ({
    maleActive: document.getElementById('bodyGenderMaleBtn').classList.contains('active'),
    femaleActive: document.getElementById('bodyGenderFemaleBtn').classList.contains('active'),
  }));
  expect(state.maleActive).toBe(true);
  expect(state.femaleActive).toBe(false);
});

// A manual toggle is still just an in-session override -- the NEXT time the
// picker opens (a fresh Termin, or the same one reopened), it must go back
// to the account's own real gender rather than "sticking" on whatever was
// last clicked, since the whole point of this feature is "automatic".
test('re-opening the picker resets back to the account\'s real gender even after a manual override', async ({ page }) => {
  await setup(page, profileRow({ is_child: false, geschlecht: 'w' }));
  await page.evaluate(() => openSymptomModal(null));
  await page.evaluate(() => setBodyGenderVariant('male'));
  let maleActive = await page.evaluate(() => document.getElementById('bodyGenderMaleBtn').classList.contains('active'));
  expect(maleActive, 'manual override took effect').toBe(true);

  await page.evaluate(() => closeSymptomModal());
  await page.evaluate(() => openSymptomModal(null));
  const state = await page.evaluate(() => ({
    femaleActive: document.getElementById('bodyGenderFemaleBtn').classList.contains('active'),
    maleActive: document.getElementById('bodyGenderMaleBtn').classList.contains('active'),
  }));
  expect(state.femaleActive, 'reopening must re-seed from the real geschlecht, not keep the last manual pick').toBe(true);
  expect(state.maleActive).toBe(false);
});

// geschlecht='d' (divers) and geschlecht=null ("keine Angabe") both have no
// dedicated figure -- must fall back gracefully (default 'male', still
// toggleable) instead of crashing or rendering nothing.
test('geschlecht=d (divers) falls back to the manual toggle default instead of crashing', async ({ page }) => {
  await setup(page, profileRow({ is_child: false, geschlecht: 'd' }));
  await page.evaluate(() => openSymptomModal(null));
  const state = await page.evaluate(() => ({
    toggleVisible: getComputedStyle(document.getElementById('bodyGenderToggle')).display !== 'none',
    frontHtml: document.getElementById('bodyFrontView').innerHTML,
    maleActive: document.getElementById('bodyGenderMaleBtn').classList.contains('active'),
  }));
  expect(state.toggleVisible).toBe(true);
  expect(state.maleActive, 'falls back to the default variant').toBe(true);
  expect(state.frontHtml.length).toBeGreaterThan(0);
});

test('a child account\'s figure is unaffected by geschlecht -- always the child figure, toggle never shown', async ({ page }) => {
  await setup(page, profileRow({ is_child: true, dob: '2020-01-01', geschlecht: 'w' }));
  await page.evaluate(() => openSymptomModal(null));
  const state = await page.evaluate(() => ({
    toggleVisible: getComputedStyle(document.getElementById('bodyGenderToggle')).display !== 'none',
    viewBox: document.getElementById('bodyFrontView').getAttribute('viewBox'),
  }));
  expect(state.toggleVisible).toBe(false);
  expect(state.viewBox).toBe('0 0 200 250');
});
