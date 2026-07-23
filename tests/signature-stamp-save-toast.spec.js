// Regression test for doctor.html's saveSig()/loadStempel(): both used to
// show a "✓ gespeichert/hochgeladen" success toast BEFORE persistSignature()
// (the real Supabase save) had even resolved, so a real save failure only
// got caught afterward by persistSignature()'s own error toast overwriting
// the premature success one -- an unnecessary flash of false information,
// unlike other optimistic-UI flows in this app that have a documented
// reason (a synchronous browser popup/print gesture) for not waiting.
// Signature/stamp saves have no such constraint, so the fix simply waits
// for the real result before claiming success.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function setupPage(page) {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
}

async function fakeStampBase64(page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 20; c.height = 20;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1d4ed8'; ctx.fillRect(0, 0, 20, 20);
    return c.toDataURL('image/png');
  });
  return dataUrl.split(',')[1];
}

test('saveSig() shows the real success toast and persists when the save actually succeeds', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    const ctx = document.getElementById('sigCanvas').getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(10, 10, 50, 20);
    await saveSig();
    return {
      toast: document.getElementById('toast')?.textContent || '',
      persisted: window.__store.staff_profiles.find(p => p.id === 'u1').sig_data_url,
    };
  });
  expect(result.toast).toContain('gespeichert');
  expect(result.persisted).toBeTruthy();
});

test('saveSig() shows only a failure toast (no premature false success) when the real save fails', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    window.__forceError = { staff_profiles: 'simulated DB error' };
    const ctx = document.getElementById('sigCanvas').getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(10, 10, 50, 20);
    await saveSig();
    const toast = document.getElementById('toast')?.textContent || '';
    delete window.__forceError;
    return { toast, persisted: window.__store.staff_profiles.find(p => p.id === 'u1').sig_data_url };
  });
  expect(result.toast).not.toContain('✓');
  expect(result.toast).toContain('fehlgeschlagen');
  expect(result.persisted).toBeFalsy();
});

test('loadStempel() shows only a failure toast (no premature false success) when the real save fails', async ({ page }) => {
  await setupPage(page);
  const base64 = await fakeStampBase64(page);
  const result = await page.evaluate(async (b64) => {
    window.__forceError = { staff_profiles: 'simulated DB error' };
    const file = new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'stempel.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    document.getElementById('stempelUpload').files = dt.files;
    await loadStempel({ target: { files: dt.files } });
    await new Promise(r => setTimeout(r, 300));
    const toast = document.getElementById('toast')?.textContent || '';
    delete window.__forceError;
    return { toast, persisted: window.__store.staff_profiles.find(p => p.id === 'u1').stempel_data_url };
  }, base64);
  expect(result.toast).not.toContain('✓');
  expect(result.toast).toContain('fehlgeschlagen');
  expect(result.persisted).toBeFalsy();
});
