// Real user feedback (2026-08-12): after the walkthrough, two more asks on
// top of the earlier UI-polish batch:
// 1. Impfpass (vaccination record) and Mutter-Kind-Pass (MKP) should be
//    their own top-level sections on the home screen, not buried inside
//    Profil.
// 2. A child's own Mutter-Kind-Pass -- filled in by the pediatrician on the
//    staff side (doctor.html's Kartei "MKP" tab, supabase/phase4_mkp_
//    untersuchungen.sql, deliberately staff-only until now) -- should show
//    up on the child's own page too, read-only.
// supabase/phase69_patient_mkp_readonly.sql adds the one new RPC this
// needs; vendor/mkp-exams.js is the single shared source of the 13 exam
// definitions for both doctor.html's editable form and this read-only view.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function profileRow(overrides) {
  return Object.assign({
    id: 'p1', username: 'maria.huber', name: 'Maria', full_name: 'Maria Huber',
    fach: null, dob: '1985-01-01', adresse: 'Alte Adresse 1', tel: '0123', email: null,
    versicherung: 'ÖGK', svnr: 'SVNR1', first_login: false, is_child: false,
  }, overrides || {});
}

async function setupRemote(page, profile, mkpRows) {
  // installMockSupabase's extraInit runs via page.addInitScript(), which
  // stringifies the function -- Node-side closures don't survive that. The
  // username is always 'maria.huber' in every profileRow() variant this
  // file uses, so it's safe to hardcode as a literal (same pattern as
  // patient-impfungen-adult-hidden.spec.js's own setupRemote()).
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria.huber' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(500);
  await page.evaluate(({ row, mkp }) => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [row], error: null });
      if (name === 'patient_get_impfungen') return Promise.resolve({ data: [], error: null });
      if (name === 'patient_get_mkp_exams') return Promise.resolve({ data: mkp, error: null });
      return Promise.resolve({ data: [], error: null });
    };
  }, { row: profile, mkp: mkpRows || [] });
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);
}

test('an adult account never shows the Mutter-Kind-Pass tile, on the home screen, desktop sidebar, or mobile bottom nav', async ({ page }) => {
  await setupRemote(page, profileRow({ is_child: false }), []);
  const state = await page.evaluate(() => ({
    tileVisible: getComputedStyle(document.getElementById('homeTileMkp')).display !== 'none',
    navTabVisible: getComputedStyle(document.getElementById('navTabMkp')).display !== 'none',
    navBottomVisible: getComputedStyle(document.getElementById('nav-mkp')).display !== 'none',
  }));
  expect(state.tileVisible).toBe(false);
  expect(state.navTabVisible).toBe(false);
  expect(state.navBottomVisible).toBe(false);
});

test('a child account shows the Mutter-Kind-Pass tile (home, desktop sidebar, mobile bottom nav), and its view lists all 13 exams with a real record shown read-only', async ({ page }) => {
  await setupRemote(page, profileRow({ is_child: true, dob: '2020-01-01' }), [
    { exam_key: 'lw4_7_allgemein', data: { gewicht: 4200, stillen: 'ja', diagnose: 'Unauffällig' }, completed_at: '2020-02-01T10:00:00Z' },
  ]);
  const state = await page.evaluate(() => ({
    tileVisible: getComputedStyle(document.getElementById('homeTileMkp')).display !== 'none',
    navTabVisible: getComputedStyle(document.getElementById('navTabMkp')).display !== 'none',
    navBottomVisible: getComputedStyle(document.getElementById('nav-mkp')).display !== 'none',
    examCardCount: document.getElementById('mkpContent').querySelectorAll('.info-card').length,
    html: document.getElementById('mkpContent').innerHTML,
  }));
  expect(state.tileVisible).toBe(true);
  expect(state.navTabVisible).toBe(true);
  expect(state.navBottomVisible).toBe(true);
  expect(state.examCardCount).toBe(13); // MKP_EXAMS.length
  expect(state.html).toContain('4200');
  expect(state.html).toContain('Ja'); // 'stillen' yn field rendered as a translated Ja/Nein, not the raw 'ja'
});

test('an incomplete MKP exam never shows staff-only editing controls, just a "not yet recorded" note -- read-only, no way to edit', async ({ page }) => {
  await setupRemote(page, profileRow({ is_child: true, dob: '2020-01-01' }), []);
  const state = await page.evaluate(() => ({
    hasInputs: document.getElementById('mkpContent').querySelectorAll('input,textarea,select').length,
    html: document.getElementById('mkpContent').innerHTML,
  }));
  expect(state.hasInputs, 'the patient-facing view must never expose an editable form field').toBe(0);
  expect(state.html).toContain('Allgemeine Untersuchung'); // first exam's title still listed, just as "not yet recorded"
});

// Real user feedback (2026-08-13): the icon must always be reachable, even
// for an adult with zero real Impfung records -- it should fill in as
// vaccines get added, not stay hidden until the first one exists (reversed
// from the earlier 2026-08-12 "hide until there's something to show"
// behavior this same tile started with).
test('the vaccination record (Impfpass) tile lives on the home screen, not inside Profil -- always visible, even for an adult with zero records', async ({ page }) => {
  await setupRemote(page, profileRow({ is_child: false }), []);
  const state = await page.evaluate(() => ({
    tileVisible: getComputedStyle(document.getElementById('homeTileImpfpass')).display !== 'none',
    navTabVisible: getComputedStyle(document.getElementById('navTabImpfpass')).display !== 'none',
    navBottomVisible: getComputedStyle(document.getElementById('nav-impfpass')).display !== 'none',
    cardVisible: getComputedStyle(document.getElementById('profilImpfungenCard')).display !== 'none',
    emptyVisible: getComputedStyle(document.getElementById('profilImpfungenEmpty')).display !== 'none',
    cardInsideProfil: document.getElementById('view-profil').contains(document.getElementById('profilImpfungenCard')),
    cardInsideImpfpassView: document.getElementById('view-impfpass').contains(document.getElementById('profilImpfungenCard')),
  }));
  expect(state.tileVisible, 'the icon itself must always be reachable').toBe(true);
  expect(state.navTabVisible).toBe(true);
  expect(state.navBottomVisible, 'the mobile bottom-nav entry must also always be reachable').toBe(true);
  // Opening it with zero records shows the "Noch keine Impfungen erfasst"
  // empty state, not the (empty) card.
  expect(state.cardVisible).toBe(false);
  expect(state.emptyVisible).toBe(true);
  expect(state.cardInsideProfil).toBe(false);
  expect(state.cardInsideImpfpassView).toBe(true);
});
