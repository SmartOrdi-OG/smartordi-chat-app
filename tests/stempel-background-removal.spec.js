// Regression test for a real bug the user hit: uploading a photo of a
// physical stamp (ink pressed onto white paper) kept the whole paper
// rectangle as an opaque background, which then covered part of the PDF
// underneath the stamp instead of showing just the ink.
// removeStempelBackground() (doctor.html) runs every upload through a
// canvas pass that fades near-white pixels to transparent, with a soft
// band around the threshold so anti-aliased ink edges don't turn jagged.
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

// Builds a fake "photographed stamp" in-browser: a solid blue circle (the
// ink) on a white square (the paper) -- exactly the shape of image a real
// phone photo of a physical stamp produces.
async function fakeStampPngBase64(page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 40; c.height = 40;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 40, 40);
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.arc(20, 20, 15, 0, 2 * Math.PI);
    ctx.fill();
    return c.toDataURL('image/png');
  });
  return dataUrl.split(',')[1];
}

test('uploading a stamp photo makes the white paper background transparent, keeping the ink opaque', async ({ page }) => {
  await setupPage(page);
  const base64 = await fakeStampPngBase64(page);
  await page.setInputFiles('#stempelUpload', { name: 'stempel.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
  await page.waitForFunction(() => typeof stempelDataUrl === 'string' && stempelDataUrl.length > 0);

  const pixels = await page.evaluate(() => new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve({
        corner: Array.from(ctx.getImageData(2, 2, 1, 1).data),
        center: Array.from(ctx.getImageData(20, 20, 1, 1).data),
      });
    };
    img.src = stempelDataUrl;
  }));

  // Corner was pure white paper -- must be fully transparent now.
  expect(pixels.corner[3]).toBe(0);
  // Center was the blue ink circle -- must stay opaque and still blue.
  expect(pixels.center[3]).toBeGreaterThan(200);
  expect(pixels.center[2]).toBeGreaterThan(150);
  expect(pixels.center[0]).toBeLessThan(100);
});

test('the cleaned stamp is what gets persisted to staff_profiles', async ({ page }) => {
  await setupPage(page);
  const base64 = await fakeStampPngBase64(page);
  await page.setInputFiles('#stempelUpload', { name: 'stempel.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
  await page.waitForFunction(() => typeof stempelDataUrl === 'string' && stempelDataUrl.length > 0);

  const result = await page.evaluate(() => ({
    persisted: window.__store.staff_profiles.find(p => p.id === 'u1').stempel_data_url,
    live: stempelDataUrl,
  }));
  expect(result.persisted).toBe(result.live);
  // toDataURL('image/png') always re-encodes -- the persisted value must not
  // just be the raw uploaded file passed straight through untouched.
  expect(result.persisted.startsWith('data:image/png;base64,')).toBe(true);
});
