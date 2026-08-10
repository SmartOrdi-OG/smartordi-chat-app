// Regression tests for two real reports (2026-08-07, with a screenshot)
// about doctor.html's Monat calendar day-cards floating window
// (#tuCalWindow, shipped in #478): it stayed open and floating on top of
// whatever tab the doctor navigated to next (real screenshot: it landed on
// top of "Kartei öffnen" in the chat overview pane, hiding it entirely --
// "لنافذة انتقلت مع kartei... لنافذة مكانها الصحيح كالندر"), and there was
// no way to move it out of the way short of closing it entirely
// ("اعمل النافذة العائمة متحركة"). Both fixes are the same underlying
// architecture in secretary.html's own #secCalWindow (Termine calendar's
// day-cards floating window), so this file covers both.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function ymd(d) { return d.toISOString().slice(0, 10); }
function ymdOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function setupDoctorPage(page, extraSeed) {
  await installMockSupabase(page, Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
  }, extraSeed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
}

async function setupSecretaryPage(page, termine) {
  await installMockSupabase(page, {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
    termine,
  }, () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, termineReady]); switchView('termine'); });
  await page.waitForTimeout(300);
}

test.describe('doctor.html #tuCalWindow', () => {
  test('closes automatically when navigating away from Kalender to another tab', async ({ page }) => {
    const today = new Date();
    const target = new Date(today.getFullYear(), today.getMonth(), 20);
    await setupDoctorPage(page, {
      patients: [{ id: 'p1', username: 'maria', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
      termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: ymd(target), time: '11:00', end_time: '11:45', status: 'bestaetigt', arzt_id: 'u1' }],
    });
    await page.evaluate((ds) => { tuSetViewMode('monat'); tuCalSelectDay(ds); }, ymd(target));
    const opened = await page.evaluate(() => document.getElementById('tuCalWindow').style.display !== 'none');
    expect(opened, 'sanity check -- the window actually opened').toBe(true);

    await page.evaluate(() => { switchView('clinic'); });
    const closed = await page.evaluate(() => document.getElementById('tuCalWindow').style.display === 'none');
    expect(closed, 'must not stay floating over the Praxis/chat tab after navigating away').toBe(true);
  });

  test('is draggable by its header to a new position, but not by clicking its × button', async ({ page }) => {
    const today = new Date();
    const target = new Date(today.getFullYear(), today.getMonth(), 20);
    await setupDoctorPage(page, {
      patients: [{ id: 'p1', username: 'maria', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
      termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: ymd(target), time: '11:00', end_time: '11:45', status: 'bestaetigt', arzt_id: 'u1' }],
    });
    await page.evaluate((ds) => { tuSetViewMode('monat'); tuCalSelectDay(ds); }, ymd(target));
    await page.waitForTimeout(200);

    const before = await page.locator('#tuCalWindow').boundingBox();
    const header = page.locator('#tuCalWindow .floating-chat-header');
    const headerBox = await header.boundingBox();
    await page.mouse.move(headerBox.x + 40, headerBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(headerBox.x + 340, headerBox.y + 260, { steps: 10 });
    await page.mouse.up();

    const after = await page.locator('#tuCalWindow').boundingBox();
    expect(after.x, 'window moved horizontally with the drag').not.toBe(before.x);
    expect(after.y, 'window moved vertically with the drag').not.toBe(before.y);

    // Dragging must not have broken the close button.
    await page.click('#tuCalWindow .floating-chat-close');
    const closed = await page.evaluate(() => document.getElementById('tuCalWindow').style.display === 'none');
    expect(closed).toBe(true);
  });

  // Real report ("عايز يبقى ليها إمكانية تكبير و تصغير"): floating windows
  // had no way to resize at all before this.
  test('has a resize grip in the bottom-right corner that grows/shrinks it', async ({ page }) => {
    const today = new Date();
    const target = new Date(today.getFullYear(), today.getMonth(), 20);
    await setupDoctorPage(page, {
      patients: [{ id: 'p1', username: 'maria', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
      termine: [{ id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: ymd(target), time: '11:00', end_time: '11:45', status: 'bestaetigt', arzt_id: 'u1' }],
    });
    await page.evaluate((ds) => { tuSetViewMode('monat'); tuCalSelectDay(ds); }, ymd(target));
    await page.waitForTimeout(200);
    // Pinned to a corner with plenty of open viewport around it -- wherever
    // tuCalPositionWindow() actually placed it (right next to the clicked
    // day cell) may leave too little room to grow by a meaningfully large,
    // reliably-testable amount before the resize handler's own
    // stay-on-screen clamp (a real, correct constraint) kicks in.
    await page.evaluate(() => {
      const win = document.getElementById('tuCalWindow');
      win.style.left = '40px'; win.style.top = '40px';
      win.style.right = 'auto'; win.style.bottom = 'auto';
    });
    const before = await page.locator('#tuCalWindow').boundingBox();

    const handle = page.locator('#tuCalWindow .floating-chat-resize-handle');
    const handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox.x + 8, handleBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 158, handleBox.y + 108, { steps: 10 });
    await page.mouse.up();

    const resized = await page.locator('#tuCalWindow').boundingBox();
    expect(resized.width).toBeGreaterThan(before.width + 100);
    expect(resized.height).toBeGreaterThan(before.height + 50);
  });
});

test.describe('secretary.html #secCalWindow', () => {
  test('closes automatically when navigating away from Termine to another tab', async ({ page }) => {
    await setupSecretaryPage(page, [
      { id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: ymdOffset(0), time: '09:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() },
    ]);
    await page.evaluate((d) => secCalSelectDay(d), ymdOffset(0));
    const opened = await page.evaluate(() => document.getElementById('secCalWindow').style.display !== 'none');
    expect(opened, 'sanity check -- the window actually opened').toBe(true);

    await page.evaluate(() => { switchView('patienten'); });
    const closed = await page.evaluate(() => document.getElementById('secCalWindow').style.display === 'none');
    expect(closed, 'must not stay floating over the Patienten tab after navigating away').toBe(true);
  });

  test('is draggable by its header to a new position', async ({ page }) => {
    await setupSecretaryPage(page, [
      { id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: ymdOffset(0), time: '09:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() },
    ]);
    await page.evaluate((d) => secCalSelectDay(d), ymdOffset(0));
    await page.waitForTimeout(200);

    const before = await page.locator('#secCalWindow').boundingBox();
    const header = page.locator('#secCalWindow .floating-chat-header');
    const headerBox = await header.boundingBox();
    await page.mouse.move(headerBox.x + 40, headerBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(headerBox.x + 300, headerBox.y + 220, { steps: 10 });
    await page.mouse.up();

    const after = await page.locator('#secCalWindow').boundingBox();
    expect(after.x, 'window moved horizontally with the drag').not.toBe(before.x);
    expect(after.y, 'window moved vertically with the drag').not.toBe(before.y);
  });

  // Real report ("عايز يبقى ليها إمكانية تكبير و تصغير"): floating windows
  // had no way to resize at all before this.
  test('has a resize grip in the bottom-right corner that grows/shrinks it, and reopening for a different day resets the size', async ({ page }) => {
    await setupSecretaryPage(page, [
      { id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: ymdOffset(0), time: '09:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() },
      { id: 't2', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle', date: ymdOffset(1), time: '09:00', status: 'bestaetigt', arzt_id: 'u1', created_at: new Date().toISOString() },
    ]);
    await page.evaluate((d) => secCalSelectDay(d), ymdOffset(0));
    await page.waitForTimeout(200);
    const before = await page.locator('#secCalWindow').boundingBox();
    // Pinned to a corner with plenty of open viewport around it -- see
    // the identical note on the #tuCalWindow resize test above.
    await page.evaluate(() => {
      const win = document.getElementById('secCalWindow');
      win.style.left = '40px'; win.style.top = '40px';
      win.style.right = 'auto'; win.style.bottom = 'auto';
    });

    const handle = page.locator('#secCalWindow .floating-chat-resize-handle');
    const handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox.x + 8, handleBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 158, handleBox.y + 108, { steps: 10 });
    await page.mouse.up();
    const resized = await page.locator('#secCalWindow').boundingBox();
    expect(resized.width, 'grew wider').toBeGreaterThan(before.width + 100);
    expect(resized.height, 'grew taller').toBeGreaterThan(before.height + 50);

    // Opening a different day's window afterward must not stay stuck at
    // the manually-resized dimensions -- it should look like a fresh
    // window again, not a leftover size unrelated to this new context.
    // secCalPositionWindow() (where the reset actually happens) only runs
    // when secCalSelectDay() receives a real click event's currentTarget --
    // a synthetic one stands in for an actual day-cell click here.
    await page.evaluate((d) => {
      const fakeCell = { getBoundingClientRect: () => ({ top: 100, right: 200, left: 100, bottom: 150 }) };
      secCalSelectDay(d, { currentTarget: fakeCell });
    }, ymdOffset(1));
    await page.waitForTimeout(200);
    const reopened = await page.locator('#secCalWindow').boundingBox();
    expect(reopened.width).toBeCloseTo(before.width, 0);
    expect(reopened.height).toBeCloseTo(before.height, 0);
  });
});

// Real report + screenshot: dragging secretary.html's #secFloatingChatWindow
// (the Messenger-style chat popup) at all made it "turn into weird sizes and
// shapes" with no way back except reloading the page. Root cause: unlike
// #secCalWindow, that window has no fixed width/height in CSS -- it's sized
// via top/right/bottom + width:auto/height:auto so its width can grow/shrink
// with the viewport (see that CSS rule's own comment). The shared drag
// helper used to clear right/bottom without ever giving the window an
// explicit width/height first, so the size had nothing left to compute from
// and collapsed to the browser's intrinsic shrink-to-fit size.
test.describe('secretary.html #secFloatingChatWindow (width:auto sizing model)', () => {
  async function openFloatingChat(page) {
    await setupSecretaryPage(page, []);
    await page.click('.nav-tab[data-view="patienten"]');
    await page.waitForTimeout(200);
    await page.evaluate(async () => { await Promise.all([patientsReady, allMessagesReady]); renderRealPatientRows(); });
    await page.click('#patientList .patient-row[data-real]:has-text("Maria Huber")');
    await page.waitForTimeout(300);
    await page.click('#secChatOpenBtn');
    await page.waitForTimeout(300);
  }

  test('dragging by the header preserves its on-screen width/height instead of collapsing', async ({ page }) => {
    await openFloatingChat(page);
    const before = await page.locator('#secFloatingChatWindow').boundingBox();
    expect(before.width, 'sanity check -- it actually has real size before dragging').toBeGreaterThan(200);

    const header = page.locator('#secFloatingChatWindow .floating-chat-header');
    const headerBox = await header.boundingBox();
    await page.mouse.move(headerBox.x + 40, headerBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(headerBox.x - 200, headerBox.y + 150, { steps: 10 });
    await page.mouse.up();

    const after = await page.locator('#secFloatingChatWindow').boundingBox();
    expect(after.x, 'sanity check -- it actually moved').not.toBe(before.x);
    expect(after.width, 'width must not collapse to an intrinsic/shrink-to-fit size mid-drag').toBeCloseTo(before.width, 0);
    expect(after.height, 'height must not collapse to an intrinsic/shrink-to-fit size mid-drag').toBeCloseTo(before.height, 0);
  });

  test('has a working resize grip too', async ({ page }) => {
    await openFloatingChat(page);
    const before = await page.locator('#secFloatingChatWindow').boundingBox();
    // Pinned to a corner with plenty of open viewport around it -- see the
    // identical note on the #tuCalWindow/#secCalWindow resize tests above.
    // Width/height must be pinned explicitly too, same reason
    // makeFloatingWindowDraggable() itself has to (see its own comment) --
    // this window has no fixed width/height in CSS, so clearing right/
    // bottom with nothing pinning width/height first collapses it to an
    // intrinsic/shrink-to-fit size, same bug the real fix targets.
    await page.evaluate(() => {
      const win = document.getElementById('secFloatingChatWindow');
      const rect = win.getBoundingClientRect();
      win.style.width = rect.width+'px'; win.style.height = rect.height+'px';
      win.style.left = '40px'; win.style.top = '40px';
      win.style.right = 'auto'; win.style.bottom = 'auto';
    });

    const handle = page.locator('#secFloatingChatWindow .floating-chat-resize-handle');
    const handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox.x + 8, handleBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 108, handleBox.y + 108, { steps: 10 });
    await page.mouse.up();

    const resized = await page.locator('#secFloatingChatWindow').boundingBox();
    expect(resized.width).toBeGreaterThan(before.width + 50);
    // Height is intentionally not asserted to grow here -- this window
    // already fills top:24 to bottom:24 by design (the whole point of its
    // width:auto sizing model), so at a typical viewport height there's
    // legitimately little to no headroom left to grow taller into; the
    // resize handler's own stay-on-screen clamp is doing exactly what it
    // should. Just confirm it never shrank.
    expect(resized.height).toBeGreaterThanOrEqual(before.height);
  });
});
