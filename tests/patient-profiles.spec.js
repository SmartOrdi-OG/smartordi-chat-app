// Phase B of the unified-account-profiles feature (supabase/phase64_
// unified_account_profiles.sql was schema/RPC-only, Phase A -- this covers
// the actual patient.html UI built on top of it): one login can now hold
// several independent patient profiles (own + any linked child/adult),
// switchable from the Profil view's new "Meine Profile" card, with
// "Kind hinzufügen"/"Erwachsene:n hinzufügen" submitting a join request
// (staff review, same as any new patient) rather than creating a profile
// outright.
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

async function setupRemote(page, profile) {
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
      return Promise.resolve({ data: [], error: null });
    };
  }, profile || profileRow());
  await page.evaluate(async () => { await initPatientData(); });
  await page.waitForTimeout(300);
}

test('renderProfilesCard() lists every profile, tags the active one, and only the others are clickable to switch', async ({ page }) => {
  await setupRemote(page);
  const rows = [
    { patient_id: 'p1', full_name: 'Maria Huber', relation: 'self', relation_label: null, practice_id: 'pr1', practice_name: 'Ordination A', is_active: true },
    { patient_id: 'c1', full_name: 'Tom Huber', relation: 'child', relation_label: null, practice_id: 'pr2', practice_name: 'Kinderarzt', is_active: false },
  ];
  const state = await page.evaluate(async (rows) => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profiles') return Promise.resolve({ data: rows, error: null });
      return Promise.resolve({ data: [], error: null });
    };
    await renderProfilesCard();
    const list = document.getElementById('profilProfilesList');
    return {
      cardVisible: getComputedStyle(document.getElementById('profilProfilesCard')).display !== 'none',
      html: list.innerHTML,
      rowCount: list.querySelectorAll('.info-row').length,
      clickableCount: list.querySelectorAll('.info-row[onclick]').length,
    };
  }, rows);
  expect(state.cardVisible).toBe(true);
  expect(state.rowCount).toBe(2);
  expect(state.clickableCount, 'only the non-active profile should be clickable').toBe(1);
  expect(state.html).toContain('Maria Huber');
  expect(state.html).toContain('Tom Huber');
});

// Real user request (2026-08-18): an adult account is a single person's
// own account, and a children's account only ever grows by adding MORE
// children -- there's no scenario where a second adult gets added onto an
// account, so that button is gone outright (not just relabelled).
// openAddProfileModal('adult') itself (and the relation picker it drives)
// is left in place, unreachable from the UI -- still exercised directly by
// the sibling tests above/below, in case a future flow needs it.
test('a children account\'s "Meine Profile" offers "+ Kind hinzufügen"; "+ Erwachsene:n hinzufügen" is gone entirely', async ({ page }) => {
  await setupRemote(page, profileRow({ is_child: true }));
  const rows = [
    { patient_id: 'p1', full_name: 'Tom Huber', relation: 'self', relation_label: null, practice_id: 'pr1', practice_name: 'Kinderarzt', is_active: true },
  ];
  const state = await page.evaluate(async (rows) => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profiles') return Promise.resolve({ data: rows, error: null });
      return Promise.resolve({ data: [], error: null });
    };
    await renderProfilesCard();
    return {
      addChildVisible: getComputedStyle(document.getElementById('profilAddChildWrap')).display !== 'none',
      addAdultPresent: !!document.querySelector('#profilProfilesCard button[onclick*="openAddProfileModal(\'adult\')"]'),
    };
  }, rows);
  expect(state.addChildVisible).toBe(true);
  expect(state.addAdultPresent).toBe(false);
});

// Follow-up request (same day, after seeing an adult account still offer
// "+ Kind hinzufügen" live): an adult account must stay single-person, full
// stop -- not just missing the "+ Erwachsene:n hinzufügen" option, but
// unable to add ANY profile at all, since only a children account can ever
// hold more than one profile.
test('an adult account\'s "Meine Profile" offers no way to add a profile at all', async ({ page }) => {
  await setupRemote(page, profileRow({ is_child: false }));
  const rows = [
    { patient_id: 'p1', full_name: 'Salem Ghanem', relation: 'self', relation_label: null, practice_id: 'pr1', practice_name: 'Ordination A', is_active: true },
  ];
  const state = await page.evaluate(async (rows) => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profiles') return Promise.resolve({ data: rows, error: null });
      return Promise.resolve({ data: [], error: null });
    };
    await renderProfilesCard();
    return {
      addChildVisible: getComputedStyle(document.getElementById('profilAddChildWrap')).display !== 'none',
      addAdultPresent: !!document.querySelector('#profilProfilesCard button[onclick*="openAddProfileModal(\'adult\')"]'),
    };
  }, rows);
  expect(state.addChildVisible, 'an adult account must never offer "+ Kind hinzufügen" either').toBe(false);
  expect(state.addAdultPresent).toBe(false);
});

test('a local/demo (non-token) account never shows the profiles card at all', async ({ page }) => {
  await installMockSupabase(page, {}, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'demo1' }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({
      demo1: { fullName: 'Demo Patient', name: 'Demo', role: 'patient' },
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(800);
  const visible = await page.evaluate(() => getComputedStyle(document.getElementById('profilProfilesCard')).display !== 'none');
  expect(visible).toBe(false);
});

// Real report (2026-08-11): a child added and approved while the parent's
// tab was already open/already logged in never showed up in "Meine
// Profile" -- there's no realtime push for this, and an installed PWA has
// no obvious "refresh" gesture (no pull-to-refresh/reload button), so a
// full app relaunch was the only workaround, which nobody would think to
// try. Opening/re-opening the Profil tab (even switching back to it, not
// just the very first load) now always re-fetches.
test('opening the Profil tab re-fetches the profiles list every time, not just on the very first load', async ({ page }) => {
  await setupRemote(page);
  const result = await page.evaluate(async () => {
    let calls = 0;
    sb.rpc = (name) => {
      if (name === 'patient_get_profiles') { calls += 1; return Promise.resolve({ data: [], error: null }); }
      return Promise.resolve({ data: [], error: null });
    };
    switchView('chat');
    switchView('profil');
    switchView('chat');
    switchView('profil');
    return { calls };
  });
  expect(result.calls, 'switching to the Profil tab must re-fetch every time, not just once').toBeGreaterThanOrEqual(2);
});

test('the 🔄 refresh button on "Meine Profile" re-fetches on demand', async ({ page }) => {
  await setupRemote(page);
  const result = await page.evaluate(async () => {
    let calls = 0;
    sb.rpc = (name) => {
      if (name === 'patient_get_profiles') { calls += 1; return Promise.resolve({ data: [], error: null }); }
      return Promise.resolve({ data: [], error: null });
    };
    const before = calls;
    document.querySelector('#profilProfilesCard button[onclick="renderProfilesCard()"]').click();
    await new Promise(r => setTimeout(r, 100));
    return { before, after: calls };
  });
  expect(result.after).toBeGreaterThan(result.before);
});

test('clicking a non-active profile switches it, without a page reload -- the whole Profil view now reflects the NEW profile', async ({ page }) => {
  await setupRemote(page, profileRow({ full_name: 'Maria Huber' }));
  const result = await page.evaluate(async () => {
    let switchCalledWith = null;
    const childProfile = { id: 'c1', username: 'tom.huber', name: 'Tom', full_name: 'Tom Huber', fach: null, dob: '2015-01-01', adresse: null, tel: null, email: null, versicherung: null, svnr: null, first_login: false };
    sb.rpc = (name, args) => {
      if (name === 'patient_switch_profile') { switchCalledWith = args; return Promise.resolve({ data: true, error: null }); }
      // Once switched, every subsequent patient_get_profile call (both the
      // rehydrate step and this switchToProfile()'s own re-run of
      // initPatientData()) must resolve to the CHILD now, exactly as a real
      // current_patient_id() flip server-side would.
      if (name === 'patient_get_profile') return Promise.resolve({ data: [childProfile], error: null });
      if (name === 'guardian_get_profile') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    };
    await switchToProfile('c1');
    return {
      switchCalledWith,
      profilName: document.getElementById('profilName').textContent,
      sessionUsername: JSON.parse(sessionStorage.getItem('smartordi_user') || 'null')?.username,
      toast: document.getElementById('toast')?.textContent || '',
    };
  });
  expect(result.switchCalledWith.p_patient_id).toBe('c1');
  expect(result.profilName, 'the Profil view must now show the newly-active profile, not the previous one').toBe('Tom Huber');
  expect(result.sessionUsername).toBe('tom.huber');
  expect(result.toast).toContain('gewechselt');
});

test('a switch the server refuses shows an error toast and leaves the current profile untouched', async ({ page }) => {
  await setupRemote(page, profileRow({ full_name: 'Maria Huber' }));
  const result = await page.evaluate(async () => {
    sb.rpc = (name) => {
      // Simulates patient_switch_profile()'s own ownership check failing --
      // e.g. a stale/tampered patient id this login was never actually
      // linked to.
      if (name === 'patient_switch_profile') return Promise.resolve({ data: false, error: null });
      return Promise.resolve({ data: [], error: null });
    };
    await switchToProfile('someone-elses-patient-id');
    return {
      profilName: document.getElementById('profilName').textContent,
      toast: document.getElementById('toast')?.textContent || '',
      toastClass: document.getElementById('toast')?.className || '',
    };
  });
  expect(result.profilName).toBe('Maria Huber');
  expect(result.toastClass).toContain('error');
});

test('openAddProfileModal("child") hides the relation picker; ("adult") shows it, and "Andere" reveals a free-text field', async ({ page }) => {
  await setupRemote(page);
  const childState = await page.evaluate(() => {
    openAddProfileModal('child');
    return {
      relationVisible: getComputedStyle(document.getElementById('apRelationWrap')).display !== 'none',
      title: document.getElementById('addProfileTitle').textContent,
    };
  });
  expect(childState.relationVisible).toBe(false);
  expect(childState.title).toContain('Kind');

  const adultState = await page.evaluate(() => {
    openAddProfileModal('adult');
    return {
      relationVisible: getComputedStyle(document.getElementById('apRelationWrap')).display !== 'none',
      labelVisibleBeforeChange: getComputedStyle(document.getElementById('apRelationLabelWrap')).display !== 'none',
    };
  });
  expect(adultState.relationVisible).toBe(true);
  expect(adultState.labelVisibleBeforeChange).toBe(false);

  const otherState = await page.evaluate(() => {
    document.getElementById('apRelation').value = 'other';
    document.getElementById('apRelation').dispatchEvent(new Event('change'));
    return { labelVisible: getComputedStyle(document.getElementById('apRelationLabelWrap')).display !== 'none' };
  });
  expect(otherState.labelVisible).toBe(true);
});

test('starting the scan without a first/last name shows an error and never requests the camera', async ({ page }) => {
  await setupRemote(page);
  const result = await page.evaluate(async () => {
    let cameraRequested = false;
    navigator.mediaDevices.getUserMedia = async () => { cameraRequested = true; return null; };
    openAddProfileModal('child');
    await startAddProfileScan();
    return {
      cameraRequested,
      errorVisible: document.getElementById('addProfileError').style.display !== 'none',
      scanningVisible: getComputedStyle(document.getElementById('apStateScanning')).display !== 'none',
    };
  });
  expect(result.cameraRequested).toBe(false);
  expect(result.errorVisible).toBe(true);
  expect(result.scanningVisible).toBe(false);
});

test('camera permission denied shows a clear camera error and returns to the form', async ({ page }) => {
  await setupRemote(page);
  const result = await page.evaluate(async () => {
    navigator.mediaDevices.getUserMedia = async () => { throw new Error('Permission denied'); };
    openAddProfileModal('adult');
    document.getElementById('apVorname').value = 'Klaus';
    document.getElementById('apNachname').value = 'Huber';
    await startAddProfileScan();
    return {
      errorVisible: document.getElementById('addProfileError').style.display !== 'none',
      errorText: document.getElementById('addProfileError').textContent,
      formVisible: getComputedStyle(document.getElementById('apStateForm')).display !== 'none',
    };
  });
  expect(result.errorVisible).toBe(true);
  expect(result.errorText).toContain('Kamera');
  expect(result.formVisible).toBe(true);
});

test('scanning an unrelated QR code shows an error instead of silently submitting to the wrong practice', async ({ page }) => {
  await setupRemote(page);
  await page.addScriptTag({ path: path.join(__dirname, '..', 'vendor', 'qrcode.js') });
  const result = await page.evaluate(async () => {
    openAddProfileModal('child');
    document.getElementById('apVorname').value = 'Tom';
    document.getElementById('apNachname').value = 'Huber';

    const qr = qrcode(0, 'M');
    qr.addData('https://example.com/totally-unrelated-content');
    qr.make();
    const img = new Image();
    const loaded = new Promise((resolve) => { img.onload = resolve; });
    img.src = qr.createDataURL(6, 4);
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(10);

    let submitCalled = false;
    sb.rpc = (name) => {
      if (name === 'patient_submit_profile_join_request') { submitCalled = true; return Promise.resolve({ data: 'req-1', error: null }); }
      return Promise.resolve({ data: [], error: null });
    };

    await startAddProfileScan();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (document.getElementById('addProfileError').style.display !== 'none') break;
    }
    return {
      submitCalled,
      errorVisible: document.getElementById('addProfileError').style.display !== 'none',
      formVisible: getComputedStyle(document.getElementById('apStateForm')).display !== 'none',
    };
  });
  expect(result.submitCalled, 'an unrelated QR code must never reach the submit RPC at all').toBe(false);
  expect(result.errorVisible).toBe(true);
  expect(result.formVisible).toBe(true);
});

test('a real practice QR code, scanned end-to-end, submits the join request with the right practice id + relation and shows the sent confirmation', async ({ page }) => {
  await setupRemote(page);
  await page.addScriptTag({ path: path.join(__dirname, '..', 'vendor', 'qrcode.js') });
  const result = await page.evaluate(async () => {
    openAddProfileModal('adult');
    document.getElementById('apVorname').value = 'Klaus';
    document.getElementById('apNachname').value = 'Huber';
    document.getElementById('apAdresse').value = 'Teststr. 1, 1010 Wien';
    document.getElementById('apSvnr').value = '1234010180';
    document.getElementById('apRelation').value = 'father';

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
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(10);

    let submitArgs = null;
    sb.rpc = (name, args) => {
      if (name === 'patient_submit_profile_join_request') { submitArgs = args; return Promise.resolve({ data: 'req-1', error: null }); }
      return Promise.resolve({ data: [], error: null });
    };

    await startAddProfileScan();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (getComputedStyle(document.getElementById('apStateSent')).display !== 'none') break;
    }
    return {
      submitArgs,
      sentVisible: getComputedStyle(document.getElementById('apStateSent')).display !== 'none',
    };
  });
  expect(result.sentVisible, 'the real jsQR decode loop should have found the practice QR within 60 frames').toBe(true);
  expect(result.submitArgs.p_practice_id).toBe('practice-real-uuid-77');
  expect(result.submitArgs.p_vorname).toBe('Klaus');
  expect(result.submitArgs.p_nachname).toBe('Huber');
  expect(result.submitArgs.p_relation).toBe('father');
  expect(result.submitArgs.p_relation_label).toBeNull();
});

test('relation "Andere" sends the typed free-text label along with the request', async ({ page }) => {
  await setupRemote(page);
  await page.addScriptTag({ path: path.join(__dirname, '..', 'vendor', 'qrcode.js') });
  const result = await page.evaluate(async () => {
    openAddProfileModal('adult');
    document.getElementById('apVorname').value = 'Erna';
    document.getElementById('apNachname').value = 'Huber';
    document.getElementById('apRelation').value = 'other';
    document.getElementById('apRelation').dispatchEvent(new Event('change'));
    document.getElementById('apRelationLabel').value = 'Großmutter';

    const qr = qrcode(0, 'M');
    qr.addData('https://chat.smartordiog.eu/patient-register/practice-real-uuid-9');
    qr.make();
    const img = new Image();
    const loaded = new Promise((resolve) => { img.onload = resolve; });
    img.src = qr.createDataURL(6, 4);
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(10);

    let submitArgs = null;
    sb.rpc = (name, args) => {
      if (name === 'patient_submit_profile_join_request') { submitArgs = args; return Promise.resolve({ data: 'req-1', error: null }); }
      return Promise.resolve({ data: [], error: null });
    };

    await startAddProfileScan();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (submitArgs) break;
    }
    return { submitArgs };
  });
  expect(result.submitArgs.p_relation).toBe('other');
  expect(result.submitArgs.p_relation_label).toBe('Großmutter');
});

test('a request submitted for "Kind hinzufügen" always sends relation="child", regardless of the (hidden) relation picker', async ({ page }) => {
  await setupRemote(page);
  await page.addScriptTag({ path: path.join(__dirname, '..', 'vendor', 'qrcode.js') });
  const result = await page.evaluate(async () => {
    openAddProfileModal('child');
    document.getElementById('apVorname').value = 'Tom';
    document.getElementById('apNachname').value = 'Huber';

    const qr = qrcode(0, 'M');
    qr.addData('https://chat.smartordiog.eu/patient-register/practice-real-uuid-9');
    qr.make();
    const img = new Image();
    const loaded = new Promise((resolve) => { img.onload = resolve; });
    img.src = qr.createDataURL(6, 4);
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(10);

    let submitArgs = null;
    sb.rpc = (name, args) => {
      if (name === 'patient_submit_profile_join_request') { submitArgs = args; return Promise.resolve({ data: 'req-1', error: null }); }
      return Promise.resolve({ data: [], error: null });
    };

    await startAddProfileScan();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (submitArgs) break;
    }
    return { submitArgs };
  });
  expect(result.submitArgs.p_relation).toBe('child');
  expect(result.submitArgs.p_relation_label).toBeNull();
});

test('extractApPracticeId() only accepts the real /patient-register/<id> scheme', async ({ page }) => {
  await setupRemote(page);
  const result = await page.evaluate(() => ({
    fullUrl: extractApPracticeId('https://chat.smartordiog.eu/patient-register/practice-real-uuid-9'),
    unrelated: extractApPracticeId('https://example.com/some-other-qr-code'),
    empty: extractApPracticeId(''),
    nullInput: extractApPracticeId(null),
  }));
  expect(result.fullUrl).toBe('practice-real-uuid-9');
  expect(result.unrelated).toBeNull();
  expect(result.empty).toBeNull();
  expect(result.nullInput).toBeNull();
});

test('closing the modal mid-scan releases the camera', async ({ page }) => {
  await setupRemote(page);
  const result = await page.evaluate(async () => {
    // video.srcObject requires a real MediaStream -- captureStream() gives
    // one with a real track, whose stop() is wrapped (not replaced) so it's
    // observable without breaking anything srcObject itself validates.
    const canvas = document.createElement('canvas');
    canvas.width = 10; canvas.height = 10;
    canvas.getContext('2d').fillRect(0, 0, 10, 10);
    const stream = canvas.captureStream(10);
    const track = stream.getTracks()[0];
    let stopped = false;
    const origStop = track.stop.bind(track);
    track.stop = () => { stopped = true; origStop(); };
    navigator.mediaDevices.getUserMedia = async () => stream;
    openAddProfileModal('child');
    document.getElementById('apVorname').value = 'Tom';
    document.getElementById('apNachname').value = 'Huber';
    await startAddProfileScan();
    closeAddProfileModal();
    return { stopped, modalOpen: document.getElementById('addProfileModal').classList.contains('show') };
  });
  expect(result.stopped).toBe(true);
  expect(result.modalOpen).toBe(false);
});

// ── Home "Kind wechseln" (real user request, 2026-08-18) -- reachable
// straight from Home instead of navigating into Profil first. Reuses the
// exact same patientGetProfiles()/switchToProfile() mechanism as "Meine
// Profile" -- these tests cover the extra entry point, not the switching
// mechanism itself (already covered by the "Meine Profile" tests above).
test('an adult account never shows the Home "Kind wechseln" button', async ({ page }) => {
  await setupRemote(page, profileRow({ is_child: false }));
  const visible = await page.evaluate(() =>
    getComputedStyle(document.getElementById('homeSwitchChildBtn')).display !== 'none'
  );
  expect(visible).toBe(false);
});

test('a children account shows the Home "Kind wechseln" button, which opens a picker listing every profile', async ({ page }) => {
  await setupRemote(page, profileRow({ is_child: true, full_name: 'Tom Huber' }));
  const rows = [
    { patient_id: 'p1', full_name: 'Tom Huber', relation: 'self', relation_label: null, practice_id: 'pr1', practice_name: 'Kinderarzt', is_active: true },
    { patient_id: 'c2', full_name: 'Lena Huber', relation: 'child', relation_label: null, practice_id: 'pr1', practice_name: 'Kinderarzt', is_active: false },
  ];
  const state = await page.evaluate(async (rows) => {
    sb.rpc = (name) => {
      if (name === 'patient_get_profiles') return Promise.resolve({ data: rows, error: null });
      return Promise.resolve({ data: [], error: null });
    };
    const btnVisible = getComputedStyle(document.getElementById('homeSwitchChildBtn')).display !== 'none';
    await openHomeChildPicker();
    const list = document.getElementById('homeChildPickerList');
    return {
      btnVisible,
      modalOpen: document.getElementById('homeChildPickerModal').classList.contains('show'),
      rowCount: list.querySelectorAll('.info-row').length,
      clickableCount: list.querySelectorAll('.info-row[onclick]').length,
      html: list.innerHTML,
    };
  }, rows);
  expect(state.btnVisible).toBe(true);
  expect(state.modalOpen).toBe(true);
  expect(state.rowCount).toBe(2);
  expect(state.clickableCount, 'only the non-active child is clickable to switch to').toBe(1);
  expect(state.html).toContain('Tom Huber');
  expect(state.html).toContain('Lena Huber');
});

test('picking a child from the Home picker switches to it and closes the modal', async ({ page }) => {
  await setupRemote(page, profileRow({ is_child: true, full_name: 'Tom Huber' }));
  const rows = [
    { patient_id: 'p1', full_name: 'Tom Huber', relation: 'self', relation_label: null, practice_id: 'pr1', practice_name: 'Kinderarzt', is_active: true },
    { patient_id: 'c2', full_name: 'Lena Huber', relation: 'child', relation_label: null, practice_id: 'pr1', practice_name: 'Kinderarzt', is_active: false },
  ];
  const result = await page.evaluate(async (rows) => {
    let switchedTo = null;
    sb.rpc = (name, args) => {
      if (name === 'patient_get_profiles') return Promise.resolve({ data: rows, error: null });
      if (name === 'patient_switch_profile') { switchedTo = args.p_patient_id; return Promise.resolve({ data: true, error: null }); }
      if (name === 'patient_get_profile') return Promise.resolve({ data: [{ id: 'c2', username: 'lena.huber', name: 'Lena', full_name: 'Lena Huber', dob: '2015-01-01', first_login: false, is_child: true }], error: null });
      return Promise.resolve({ data: [], error: null });
    };
    await openHomeChildPicker();
    await switchToProfileFromHome('c2');
    return {
      switchedTo,
      modalOpen: document.getElementById('homeChildPickerModal').classList.contains('show'),
    };
  }, rows);
  expect(result.switchedTo).toBe('c2');
  expect(result.modalOpen).toBe(false);
});
