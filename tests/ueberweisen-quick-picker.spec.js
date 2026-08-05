// Regression tests for the "Patient überweisen" quick-picker in the chat
// overview pane -- a fast on-ramp into the existing Kartei "Überweisung" tab
// (external referral, any specialty) that doesn't require a doctor to find
// that tab under "Mehr" first (its button was removed from there when this
// shipped, since the overview-pane picker is now the primary entry point).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', adresse: 'Hauptstraße 5, 4020 Linz', join_status: 'approved' }],
  }, extra);
}

async function setupPage(page) {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    await Promise.all([patientsReady, allMessagesReady, termineReady, practiceSettingsReady]);
    const item = [...document.querySelectorAll('.patient-item')].find(el => el.textContent.includes('Maria Huber'));
    item.click();
  });
}

test('"Überweisung" no longer has its own button in the Kartei Mehr dropdown', async ({ page }) => {
  await setupPage(page);
  const hasButton = await page.evaluate(() => !!document.querySelector('#karteiMehrMenu .kartei-tab[onclick*="ueberweisung"]'));
  expect(hasButton).toBe(false);
});

test('clicking "Überweisen" without a Fachrichtung shows an error and does not switch tabs', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(() => {
    startUeberweisenFromOverview();
    return {
      toastText: document.getElementById('toast')?.textContent || '',
      uwTabVisible: getComputedStyle(document.getElementById('ktab-ueberweisung')).display !== 'none',
    };
  });
  expect(result.toastText).toContain('Fachrichtung');
  expect(result.uwTabVisible, 'must not have switched into the Überweisung tab without a Fachrichtung').toBe(false);
});

test('picking a Fachrichtung and an external doctor name, then clicking "Überweisen", opens the Kartei straight into the Überweisung tab, pre-filled', async ({ page }) => {
  await setupPage(page);
  // Set via JS, not page.selectOption()/page.fill() -- #patientOverviewPane
  // sits inside the Praxis view, which isn't the default landing tab
  // (Kalender is), so these inputs aren't Playwright-actionable-visible
  // without also switching views first. Every other test in this suite
  // that drives the overview pane (see patient-overview-chat.spec.js) does
  // the same, driving the DOM directly instead.
  const result = await page.evaluate(() => {
    document.getElementById('uwQuickFach').value = 'Kardiologie';
    document.getElementById('uwQuickArzt').value = 'Dr. Klaus Weber – Kardiologie Wien';
    startUeberweisenFromOverview();
    return {
      uwTabVisible: getComputedStyle(document.getElementById('ktab-ueberweisung')).display !== 'none',
      fach: document.getElementById('uwFach').value,
      an: document.getElementById('uwAn').value,
      patientName: document.getElementById('uw-patient-name')?.textContent,
      quickFachCleared: document.getElementById('uwQuickFach').value,
      quickArztCleared: document.getElementById('uwQuickArzt').value,
    };
  });
  expect(result.uwTabVisible, 'must have switched straight into the Überweisung tab').toBe(true);
  expect(result.fach).toBe('Kardiologie');
  expect(result.an).toBe('Dr. Klaus Weber – Kardiologie Wien');
  expect(result.patientName).toBe('Maria Huber');
  expect(result.quickFachCleared, 'the quick-picker itself must clear afterward, ready for next time').toBe('');
  expect(result.quickArztCleared).toBe('');
});

test('the "Name des Arztes/der Praxis" field is optional -- picking only a Fachrichtung still works', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(() => {
    document.getElementById('uwQuickFach').value = 'Neurologie';
    startUeberweisenFromOverview();
    return {
      uwTabVisible: getComputedStyle(document.getElementById('ktab-ueberweisung')).display !== 'none',
      fach: document.getElementById('uwFach').value,
    };
  });
  expect(result.uwTabVisible).toBe(true);
  expect(result.fach).toBe('Neurologie');
});
