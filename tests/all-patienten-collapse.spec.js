// Regression tests for the "Alle Patienten" collapsible section in
// doctor.html's clinic sidebar. The user asked for the "Heute"/"Alle
// Patienten" section labels to be bolder/clearer, and for "Alle Patienten"
// specifically to become a collapse/expand toggle (collapsed by default,
// remembered per device via localStorage). Since "Erweiterte Suche"
// (advSearch()) and the plain name search (filterPatientsList()) both just
// toggle each .patient-item's own display style and rely on every patient
// already being in the DOM, a match sitting inside a still-collapsed
// section would otherwise stay invisible -- these tests cover that
// interaction too, not just the toggle itself.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [
      { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria Huber', versicherung: 'ÖGK', svnr: '1234140385', dob: '1985-01-01', join_status: 'approved' },
      { id: 'p2', username: 'peter.gruber', full_name: 'Peter Gruber', name: 'Peter Gruber', versicherung: 'BVAEB', svnr: '5678220190', dob: '1990-06-15', join_status: 'approved' },
    ],
  };
}

async function setupPage(page) {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, allMessagesReady]); });
}

test('"Alle Patienten" is collapsed by default (no prior localStorage preference)', async ({ page }) => {
  await setupPage(page);
  const state = await page.evaluate(() => ({
    groupDisplay: document.getElementById('allPatientsGroup')?.style.display,
    titleHasCollapsedClass: document.getElementById('allPatientsTitle')?.classList.contains('collapsed'),
  }));
  expect(state.groupDisplay).toBe('none');
  expect(state.titleHasCollapsedClass).toBe(true);
});

test('clicking the "Alle Patienten" title expands it and persists the preference across a re-render', async ({ page }) => {
  await setupPage(page);
  const afterClick = await page.evaluate(() => {
    document.getElementById('allPatientsTitle').click();
    return {
      groupDisplay: document.getElementById('allPatientsGroup').style.display,
      stored: localStorage.getItem('smartordi_all_patients_collapsed'),
    };
  });
  expect(afterClick.groupDisplay).toBe('');
  expect(afterClick.stored).toBe('0');

  // Re-rendering (e.g. a new message arriving) must not silently re-collapse it.
  const afterRerender = await page.evaluate(() => {
    renderPatientList();
    return document.getElementById('allPatientsGroup').style.display;
  });
  expect(afterRerender).toBe('');
});

test('clicking again re-collapses it and persists that too', async ({ page }) => {
  await setupPage(page);
  const state = await page.evaluate(() => {
    document.getElementById('allPatientsTitle').click(); // expand
    document.getElementById('allPatientsTitle').click(); // collapse again
    return {
      groupDisplay: document.getElementById('allPatientsGroup').style.display,
      stored: localStorage.getItem('smartordi_all_patients_collapsed'),
    };
  });
  expect(state.groupDisplay).toBe('none');
  expect(state.stored).toBe('1');
});

test('typing in the main search box force-expands the section so a match is actually visible, then restores collapse when cleared', async ({ page }) => {
  await setupPage(page);
  const whileSearching = await page.evaluate(async () => {
    // filterPatientsList() is now a real live search (searchPatientsServer())
    // that discards a stale response if #patientSearchInput's value has
    // since changed -- set it here too, matching what real typing does via
    // the debounced oninput handler, or the awaited call below would be
    // discarded as "stale" against the input's still-empty value.
    document.getElementById('patientSearchInput').value = 'Peter';
    await filterPatientsList('Peter');
    const peter = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Peter Gruber'));
    return {
      groupDisplay: document.getElementById('allPatientsGroup').style.display,
      peterVisible: peter.style.display !== 'none',
    };
  });
  expect(whileSearching.groupDisplay, 'section must force-open during an active search, or a match would be invisible').toBe('');
  expect(whileSearching.peterVisible).toBe(true);

  const afterClearing = await page.evaluate(async () => {
    document.getElementById('patientSearchInput').value = '';
    await filterPatientsList('');
    return document.getElementById('allPatientsGroup').style.display;
  });
  expect(afterClearing, 'clearing the search restores the actual (collapsed-by-default) preference').toBe('none');
});

test('"Erweiterte Suche" (advSearch) also force-expands the section, and clearAdvSearch() restores the collapsed default', async ({ page }) => {
  await setupPage(page);
  const whileFiltering = await page.evaluate(() => {
    document.getElementById('adv-svnr').value = '5678';
    advSearch();
    const peter = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Peter Gruber'));
    return {
      groupDisplay: document.getElementById('allPatientsGroup').style.display,
      peterVisible: peter.style.display !== 'none',
    };
  });
  expect(whileFiltering.groupDisplay).toBe('');
  expect(whileFiltering.peterVisible).toBe(true);

  const afterClear = await page.evaluate(() => {
    clearAdvSearch();
    return document.getElementById('allPatientsGroup').style.display;
  });
  expect(afterClear).toBe('none');
});

test('the section header shows the real "Alle Patienten" count', async ({ page }) => {
  await setupPage(page);
  const titleText = await page.evaluate(() => document.getElementById('allPatientsTitle').textContent);
  expect(titleText).toContain('Alle Patienten (2)');
});
