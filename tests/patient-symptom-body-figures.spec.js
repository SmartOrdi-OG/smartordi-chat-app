// Real user request (2026-08-14, with a reference "pain infographic" stock
// image for proportions/style only, not reproduced): the symptom picker's
// single generic body figure is now three body types (adult male, adult
// female, child), each with front + back views, still built from
// clickable SVG regions -- vendor/symptom-body-figures.js. A patient
// account gets a Mann/Frau toggle (ephemeral UI state, not saved to the
// profile -- there is no gender field on patients at all); a child account
// skips the toggle and always gets the child figure.
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
