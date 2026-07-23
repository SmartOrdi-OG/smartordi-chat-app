// Regression test for a real bug found while looking for more undiscovered
// issues after the Verlauf persistence fix: saveAnamnese() (doctor.html)
// showed "✓ Anamnese gespeichert!" unconditionally at the end of the
// function, regardless of whether anything upstream actually ran. Both "no
// patient selected" and "patient has no real Supabase account yet" silently
// skipped the save entirely (the whole body was wrapped in an
// `if(currentName){ if(found){ ...save... } }`) and still fell through to
// the same success toast -- a false-positive success message with nothing
// actually saved, the exact class of bug this project has repeatedly fixed
// elsewhere (confirmTransfer, double-booking, etc.).
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

async function setupPage(page) {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await patientsReady; });
}

test('refuses (no false success) when no patient is selected', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('kartei-name').textContent = 'Kein Patient ausgewählt';
    await saveAnamnese();
    return { toast: document.getElementById('toast')?.textContent || '', patientsWrites: window.__store.patients.length };
  });
  expect(result.toast).not.toContain('gespeichert');
  expect(result.toast).toContain('Patienten auswählen');
  // The seeded patient must be untouched -- still exactly the one row from setup.
  expect(result.patientsWrites).toBe(1);
});

test('refuses (no false success) when the patient has no real Supabase account', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('kartei-name').textContent = 'Ghost Patient';
    await saveAnamnese();
    return { toast: document.getElementById('toast')?.textContent || '' };
  });
  expect(result.toast).not.toContain('✓');
  expect(result.toast).toContain('Cloud-Konto');
});

test('actually saves the anamnese data to the patient\'s real record', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    switchKarteiTab('anamnese', document.querySelector('.kartei-tab[onclick*="anamnese"]'));
    const root = document.getElementById('anamnese-collapse-body');
    const firstInput = root.querySelector('input,select,textarea');
    if (firstInput) {
      if (firstInput.type === 'checkbox') firstInput.checked = true;
      else firstInput.value = 'Test-Antwort';
    }
    await saveAnamnese();
    return {
      toast: document.getElementById('toast')?.textContent || '',
      saved: window.__store.patients.find(p => p.username === 'maria.huber').anamnese,
    };
  });
  expect(result.toast).toContain('gespeichert');
  expect(result.saved).toBeTruthy();
});

test('shows a failure toast (not a false success) when the save call itself fails', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    window.__forceError = { patients: 'simulated DB error' };
    await saveAnamnese();
    delete window.__forceError;
    return document.getElementById('toast')?.textContent || '';
  });
  expect(result).toContain('fehlgeschlagen');
  expect(result).not.toContain('✓');
});
