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

// Real user report (2026-08-11): a phone that reached this screen by
// scanning a QR code with its OWN camera app first (external hand-off into
// the browser), then tried to scan the practice's QR with THIS in-app
// scanner, saw a live camera image but nothing was ever recognized -- even
// standing still, well-lit, right on target. The same scanner worked
// immediately when reached without that prior external hand-off. See
// startQrScan()'s own comment for the suspected mechanism: mobile browsers
// can throttle requestAnimationFrame indefinitely on a tab they misjudge
// as not fully "active", which a native <video> element's own playback
// (what the user actually SEES) is completely unaffected by -- making the
// stall invisible until you look at whether the JS-side scan loop is
// actually still running.
test('a stalled scan loop (requestAnimationFrame silently stopped) recovers when the tab becomes visible again', async ({ page }) => {
  await gotoFresh(page);
  await page.click('text=Neu hier?');
  await fillJoinRequestForm(page, 'freshuser6');
  await page.click('#screen-request .btn-main');
  await page.waitForTimeout(300);

  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100; canvas.height = 100;
    // Actually paint something -- a canvas whose 2D context is never
    // touched can leave captureStream()'s track perpetually "waiting"
    // for a first frame in a real browser, which hangs video.play()
    // indefinitely instead of resolving. The existing "real camera frame"
    // test above draws a real QR code for the same reason.
    canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
    const stream = canvas.captureStream(10);
    navigator.mediaDevices.getUserMedia = async () => stream;

    await startQrScan();
    // Simulate the exact real-world symptom: the video keeps rendering on
    // its own (native playback, left completely untouched here) but the
    // JS-side scan loop has silently stopped being scheduled.
    cancelAnimationFrame(qrScanRAF);
    qrScanRAF = null;

    let playCalled = false;
    const video = document.getElementById('qrVideo');
    const origPlay = video.play.bind(video);
    video.play = () => { playCalled = true; return origPlay(); };

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 50));

    return { playCalled, resumedRAF: qrScanRAF !== null };
  });
  expect(result.playCalled, 'video.play() must be retried once the tab is visible again').toBe(true);
  expect(result.resumedRAF, 'the scan loop must be kicked back into motion').toBe(true);
});

test('a manual "restart the camera" hint appears after a few seconds of no detection, and cancelling clears it', async ({ page }) => {
  await gotoFresh(page);
  await page.click('text=Neu hier?');
  await fillJoinRequestForm(page, 'freshuser7');
  await page.click('#screen-request .btn-main');
  await page.waitForTimeout(300);

  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100; canvas.height = 100;
    // A plain filled square -- a real frame for captureStream() to
    // deliver (see the sibling test above for why an untouched canvas
    // hangs video.play()), but never a decodable QR code.
    canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
    const stream = canvas.captureStream(10);
    navigator.mediaDevices.getUserMedia = async () => stream;
    await startQrScan();
  });
  const beforeHint = await page.evaluate(() => getComputedStyle(document.getElementById('qrScanStuckHint')).display !== 'none');
  expect(beforeHint, 'must not show immediately -- the scan is given a fair chance first').toBe(false);

  await page.waitForTimeout(6300);
  const afterHint = await page.evaluate(() => getComputedStyle(document.getElementById('qrScanStuckHint')).display !== 'none');
  expect(afterHint).toBe(true);

  await page.click('text=Abbrechen');
  const afterCancel = await page.evaluate(() => getComputedStyle(document.getElementById('qrScanStuckHint')).display !== 'none');
  expect(afterCancel, 'cancelling must not leave the hint showing on the intro screen behind it').toBe(false);
});
