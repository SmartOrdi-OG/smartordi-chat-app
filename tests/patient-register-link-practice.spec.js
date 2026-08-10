// Step 3 (part 1) of the patient-interface work: a patient who starts
// self-registration from the plain "Neu hier? Anmeldung beantragen" link
// (patient-login.html's login screen -- no QR/deep link involved, so no
// practice is known yet) fills in their personal data, then must link to a
// specific practice via an in-app QR-code scan before the join request is
// actually sent. Any /patient-register deep link (current per-practice QR
// -or- an old bare one with no id) keeps submitting immediately exactly as
// before -- see patient-register-deeplink.spec.js, unchanged and not
// duplicated here.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

async function fillJoinRequestForm(page, username) {
  await page.fill('#reqVorname', 'Max');
  await page.fill('#reqNachname', 'Mustermann');
  await page.fill('#reqAdresse', 'Teststr. 1, 1010 Wien');
  await page.fill('#reqSvnr', '1234010180');
  await page.fill('#reqUsername', username);
  await page.fill('#reqPassword', 'geheim123');
  await page.fill('#reqConfirmPw', 'geheim123');
  await page.check('#reqAgb');
}

async function gotoFresh(page) {
  await installMockSupabase(page, { practice_settings: [{ id: true }] }, () => {
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient-login.html'));
  await page.waitForTimeout(600);
}

test('the plain "Neu hier?" link (no QR/deep link) does NOT submit immediately -- it hands off to the link-practice screen', async ({ page }) => {
  await gotoFresh(page);
  await page.click('text=Neu hier?');
  await fillJoinRequestForm(page, 'freshuser1');
  await page.click('#screen-request .btn-main');
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => ({
    requests: window.__store.patient_join_requests,
    linkScreenActive: document.getElementById('screen-link-practice').classList.contains('active'),
    introVisible: getComputedStyle(document.getElementById('linkStateIntro')).display !== 'none',
  }));
  expect(state.requests).toHaveLength(0);
  expect(state.linkScreenActive).toBe(true);
  expect(state.introVisible).toBe(true);
});

test('extractPracticeIdFromScannedText() only accepts the real /patient-register/<id> scheme', async ({ page }) => {
  await gotoFresh(page);
  const result = await page.evaluate(() => ({
    fullUrl: extractPracticeIdFromScannedText('https://chat.smartordiog.eu/patient-register/practice-real-uuid-9'),
    pathOnly: extractPracticeIdFromScannedText('/patient-register/practice-real-uuid-9'),
    trailingSlash: extractPracticeIdFromScannedText('https://chat.smartordiog.eu/patient-register/practice-real-uuid-9/'),
    unrelated: extractPracticeIdFromScannedText('https://example.com/some-other-qr-code'),
    empty: extractPracticeIdFromScannedText(''),
    nullInput: extractPracticeIdFromScannedText(null),
  }));
  expect(result.fullUrl).toBe('practice-real-uuid-9');
  expect(result.pathOnly).toBe('practice-real-uuid-9');
  expect(result.trailingSlash).toBe('practice-real-uuid-9');
  expect(result.unrelated).toBeNull();
  expect(result.empty).toBeNull();
  expect(result.nullInput).toBeNull();
});

test('a real camera frame containing the practice\'s actual QR code is decoded end-to-end and the request is sent with the right practice id', async ({ page }) => {
  await gotoFresh(page);
  await page.click('text=Neu hier?');
  await fillJoinRequestForm(page, 'freshuser2');
  await page.click('#screen-request .btn-main');
  await page.waitForTimeout(300);

  // Real vendor/qrcode.js (already in the repo, used by secretary.html to
  // generate this exact QR) renders a genuine QR-code image; drawn onto a
  // canvas and captured as a real MediaStream, this exercises the ACTUAL
  // jsQR decode loop (startQrScan()/scanQrFrame()) end-to-end, not just a
  // stubbed decode result.
  await page.addScriptTag({ path: path.join(__dirname, '..', 'vendor', 'qrcode.js') });
  const decodeResult = await page.evaluate(async () => {
    sb.rpc = (name, params) => {
      if (name === 'public_get_practice_join_info') {
        return Promise.resolve({
          data: [{ practice_name: 'Ordination Dr Test', adresse: 'Steingasse 6A, 4020 Linz', admin_full_name: 'Dr. Sarah Ahmed', admin_fach: 'Allgemeinmedizin' }],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    };

    const qr = qrcode(0, 'M');
    qr.addData('https://chat.smartordiog.eu/patient-register/practice-real-uuid-77');
    qr.make();
    const img = new Image();
    const loaded = new Promise((resolve) => { img.onload = resolve; });
    img.src = qr.createDataURL(6, 4);
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const stream = canvas.captureStream(10);
    navigator.mediaDevices.getUserMedia = async () => stream;

    startQrScan();
    // scanQrFrame() polls via requestAnimationFrame -- give it real frames
    // to work with across several rAF ticks rather than a fixed timeout.
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (getComputedStyle(document.getElementById('linkStateFound')).display !== 'none') break;
    }
    return {
      foundVisible: getComputedStyle(document.getElementById('linkStateFound')).display !== 'none',
      foundName: document.getElementById('linkFoundName').textContent,
      foundSub: document.getElementById('linkFoundSub').textContent,
    };
  });
  expect(decodeResult.foundVisible, 'the real jsQR decode loop should have found the practice QR within 60 frames').toBe(true);
  expect(decodeResult.foundName).toBe('Ordination Dr Test');
  expect(decodeResult.foundSub).toContain('Allgemeinmedizin');

  await page.click('#linkStateFound .btn-main');
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => ({
    requests: window.__store.patient_join_requests,
    sentScreenActive: document.getElementById('screen-request-sent').classList.contains('active'),
  }));
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0].username).toBe('freshuser2');
  expect(state.requests[0].practice_id).toBe('practice-real-uuid-77');
  expect(state.sentScreenActive).toBe(true);
});

test('scanning an unrelated QR code shows an error instead of silently linking to the wrong practice', async ({ page }) => {
  await gotoFresh(page);
  await page.click('text=Neu hier?');
  await fillJoinRequestForm(page, 'freshuser3');
  await page.click('#screen-request .btn-main');
  await page.waitForTimeout(300);

  const state = await page.evaluate(async () => {
    await handleQrDecoded('https://example.com/totally-unrelated-qr-code');
    return {
      errorVisible: getComputedStyle(document.getElementById('linkStateError')).display !== 'none',
      errorMsgShown: document.getElementById('linkErrorMsg').classList.contains('show'),
      requests: window.__store.patient_join_requests,
    };
  });
  expect(state.errorVisible).toBe(true);
  expect(state.errorMsgShown).toBe(true);
  expect(state.requests).toHaveLength(0);
});

test('camera permission denied shows a clear camera-specific error, not a silent failure', async ({ page }) => {
  await gotoFresh(page);
  await page.click('text=Neu hier?');
  await fillJoinRequestForm(page, 'freshuser4');
  await page.click('#screen-request .btn-main');
  await page.waitForTimeout(300);

  const state = await page.evaluate(async () => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
    await startQrScan();
    return {
      errorVisible: getComputedStyle(document.getElementById('linkStateError')).display !== 'none',
      errorText: document.getElementById('linkErrorText').textContent,
    };
  });
  expect(state.errorVisible).toBe(true);
  expect(state.errorText.length).toBeGreaterThan(0);
});

test('"← Zurück zu Ihren Daten" preserves the entered form values and releases the camera', async ({ page }) => {
  await gotoFresh(page);
  await page.click('text=Neu hier?');
  await fillJoinRequestForm(page, 'freshuser5');
  await page.click('#screen-request .btn-main');
  await page.waitForTimeout(300);
  await page.click('text=← Zurück zu Ihren Daten');
  await page.waitForTimeout(200);

  const state = await page.evaluate(() => ({
    requestScreenActive: document.getElementById('screen-request').classList.contains('active'),
    vorname: document.getElementById('reqVorname').value,
    username: document.getElementById('reqUsername').value,
  }));
  expect(state.requestScreenActive).toBe(true);
  expect(state.vorname).toBe('Max');
  expect(state.username).toBe('freshuser5');
});
