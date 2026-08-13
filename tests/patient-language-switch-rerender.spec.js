// Real user feedback (2026-08-13, with screenshots): switching the
// language dropdown on patient.html left "Meine Profile" (renderProfilesCard())
// showing the relation label ("Kind"/"طفل") and "Aktiv"/"نشط" badge in
// whatever language was active the last time that card happened to render
// (page load, or the manual 🔄 refresh) -- not the newly selected one.
//
// Root cause: onPatientLanguageChanged() re-runs every function that builds
// dynamic HTML via tr() at render time (renderCalendar, renderPatientTermine,
// renderProfilImpfungen, renderMkpView, renderPatientMessages, ...) so their
// text updates immediately on a language switch, same as applyI18n()'s
// static [data-i18n] walk -- but renderProfilesCard() was missing from that
// list, even though profilesRelationLabel()/the "Aktiv" badge are built the
// exact same way (tr() inside a template string, not a static [data-i18n]
// element applyI18n() would already catch).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function profileRow(overrides) {
  return Object.assign({
    id: 'p1', username: 'maria.huber', name: 'Maria', full_name: 'Maria Huber',
    fach: null, dob: '1985-01-01', adresse: 'Alte Adresse 1', tel: null, email: null,
    versicherung: 'ÖGK', svnr: 'SVNR1', first_login: false,
  }, overrides || {});
}

async function setupRemote(page, profilesRows) {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria.huber' }));
    sessionStorage.setItem('smartordi_patient_token', 'tok-1');
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_patient_lang', 'de');
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(500);
  await page.evaluate(({ row, profiles }) => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profile') return Promise.resolve({ data: [row], error: null });
      if (name === 'patient_get_profiles') return Promise.resolve({ data: profiles, error: null });
      return Promise.resolve({ data: [], error: null });
    };
  }, { row: profileRow(), profiles: profilesRows });
  await page.evaluate(async () => { await initPatientData(); await renderProfilesCard(); });
  await page.waitForTimeout(300);
}

test('switching language re-renders "Meine Profile"\'s relation label and Aktiv badge, not just static [data-i18n] text', async ({ page }) => {
  await setupRemote(page, [
    { patient_id: 'p1', full_name: 'Maria Huber', relation: 'self', relation_label: null, practice_id: 'pr1', practice_name: 'Ordination A', is_active: true },
    { patient_id: 'c1', full_name: 'Tom Huber', relation: 'child', relation_label: null, practice_id: 'pr2', practice_name: 'Kinderarzt', is_active: false },
  ]);

  const beforeHtml = await page.evaluate(() => document.getElementById('profilProfilesList').innerHTML);
  expect(beforeHtml).toContain('Kind');
  expect(beforeHtml).toContain('Aktiv');

  await page.evaluate(() => setPatientLanguage('ar'));
  await page.waitForTimeout(200);
  const arHtml = await page.evaluate(() => document.getElementById('profilProfilesList').innerHTML);
  expect(arHtml, 'relation label must switch to Arabic without needing a manual refresh').toContain('طفل');
  expect(arHtml, 'the active badge must switch to Arabic too').toContain('نشط');
  expect(arHtml).not.toContain('>Kind<');
  expect(arHtml).not.toContain('>Aktiv<');

  // And switching back must not leave it stuck on the previous language
  // either -- this is the exact inversion the real bug report showed.
  await page.evaluate(() => setPatientLanguage('de'));
  await page.waitForTimeout(200);
  const deHtml = await page.evaluate(() => document.getElementById('profilProfilesList').innerHTML);
  expect(deHtml).toContain('Kind');
  expect(deHtml).toContain('Aktiv');
  expect(deHtml).not.toContain('طفل');
  expect(deHtml).not.toContain('نشط');
});
