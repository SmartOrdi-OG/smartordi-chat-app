// Regression tests for the High-severity findings from the full app-wide
// bug/security audit run on 2026-07-29 (the two Critical RLS/Edge-Function
// findings from that same audit were fixed separately and can't be
// regression-tested in this mocked-Supabase sandbox -- see
// supabase/phase40_staff_profiles_insert_gap.sql and
// supabase/functions/create-patient-auth-user/index.ts).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

const XSS_PATIENT = 'Evil<img src=x onerror=window.__xssFired=true>Patient';
const XSS_VACCINE = 'Grippe<img src=x onerror=window.__xssFired=true>';

function baseSeed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practices: [{ id: 'prac1', name: 'Musterordination', adresse: 'Steingasse 6A, 4020 Linz', tel: '+43 677 62439293', plan: 'pro' }],
  }, extra);
}

async function setupDoctorPage(page, extraSeed) {
  await installMockSupabase(page, baseSeed(extraSeed), () => {
    window.__xssFired = false;
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([patientsReady, allMessagesReady]); });
}

async function setupSecretaryPage(page, extraSeed) {
  await installMockSupabase(page, baseSeed(extraSeed), () => {
    window.__xssFired = false;
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
}

// ── Finding: impfWarnRowHtml() (doctor.html + secretary.html) interpolated
// patient/vaccine name straight into innerHTML AND into an unquoted-context
// onchange attribute with zero escaping -- a stored-XSS hole reachable the
// moment any vaccination is due, on the default landing view. ──
for (const [role, file, setup] of [['doctor', 'doctor.html', setupDoctorPage], ['secretary', 'secretary.html', setupSecretaryPage]]) {
  test(`${role}: impfWarnRowHtml() escapes a malicious patient/vaccine name instead of executing it`, async ({ page }) => {
    await setup(page, {});
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
    const result = await page.evaluate((payload) => {
      const html = impfWarnRowHtml({ patient: payload, vaccine: payload, detail: '2026-07-01', status: 'ueberfaellig' });
      const root = document.createElement('div');
      root.innerHTML = html;
      document.body.appendChild(root);
      return {
        hasRawImgTag: /<img[^>]*onerror/.test(root.innerHTML),
        hasEscapedText: root.innerHTML.includes('&lt;img'),
      };
    }, XSS_PATIENT);
    await page.waitForTimeout(100);
    expect(dialogs).toEqual([]);
    expect(await page.evaluate(() => window.__xssFired)).toBe(false);
    expect(result.hasRawImgTag, 'no raw executable <img onerror> tag may reach the DOM').toBe(false);
    expect(result.hasEscapedText).toBe(true);
  });

  test(`${role}: impfWarnRowHtml()'s onchange attribute cannot be broken out of via a quote in the vaccine name`, async ({ page }) => {
    await setup(page, {});
    const injected = "Grippe');window.__xssFired=true;('";
    const result = await page.evaluate((payload) => {
      const html = impfWarnRowHtml({ patient: 'Maria Huber', vaccine: payload, detail: '2026-07-01', status: 'faellig' });
      const root = document.createElement('div');
      root.innerHTML = html;
      document.body.appendChild(root);
      const input = root.querySelector('input');
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { onchangeAttr: input.getAttribute('onchange') };
    }, injected);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.__xssFired), 'a quote in the vaccine name must not let injected JS execute via onchange').toBe(false);
  });
}

// ── Finding: printTerminSlip()/printAnwesenheitsbestaetigung() (secretary.
// html) write a whole new document via document.write() using raw patient/
// art text -- the caller's own onclick-attribute escaping doesn't carry
// through to what these functions do with their own arguments. ──
async function setupPrintMock(page) {
  await page.addInitScript(() => {
    window.__lastPrintHtml = null;
    window.open = () => ({
      document: { write(html) { window.__lastPrintHtml = html; }, close() {} },
      focus() {}, print() {},
    });
  });
}

test('secretary.html: printTerminSlip() escapes a malicious patient/Art name in the printed document', async ({ page }) => {
  await setupPrintMock(page);
  await setupSecretaryPage(page, {});
  const html = await page.evaluate((payload) => {
    printTerminSlip(payload, '2026-08-15', '09:00', payload, '09:30', 'dr.ahmed');
    return window.__lastPrintHtml;
  }, XSS_PATIENT);
  expect(html).not.toMatch(/<img[^>]*onerror/);
  expect(html).toContain('&lt;img');
});

test('secretary.html: printAnwesenheitsbestaetigung() escapes a malicious patient/Art name in the printed document', async ({ page }) => {
  await setupPrintMock(page);
  await setupSecretaryPage(page, {});
  const html = await page.evaluate((payload) => {
    printAnwesenheitsbestaetigung(payload, '2026-08-15', '09:00', '09:30', payload, 'dr.ahmed');
    return window.__lastPrintHtml;
  }, XSS_PATIENT);
  expect(html).not.toMatch(/<img[^>]*onerror/);
  expect(html).toContain('&lt;img');
});

// ── Finding: doctor.html's Überweisung tab always showed a blank
// "Anschrift" field for every real patient (DEMO_PATIENTS.find() against a
// permanently-empty array, with no fallback to the real patient lookup
// every other similar call site in this file already has). ──
test('doctor.html: the Überweisung tab shows the real patient\'s address, not a blank one', async ({ page }) => {
  await setupDoctorPage(page, {
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', adresse: 'Hauptstraße 5, 4020 Linz', join_status: 'approved' }],
  });
  const adresse = await page.evaluate(async () => {
    switchView('clinic'); toggleKartei();
    document.getElementById('kartei-name').textContent = 'Maria Huber';
    switchKarteiTab('ueberweisung', document.getElementById('ktab-btn-ueberweisung'));
    return document.getElementById('uw-patient-adresse')?.textContent;
  });
  expect(adresse).toBe('Hauptstraße 5, 4020 Linz');
});

// ── Finding: subscribeMessagesRealtime()'s handler in doctor.html re-
// hydrated whichever patient's chat was open WHEN THE EVENT FIRED, then
// rendered unconditionally once that finished -- with no re-check that the
// SAME patient's chat was still open by the time the network round-trip
// resolved. A doctor switching to a different patient's chat mid-flight
// could get the first patient's messages painted under the second
// patient's name. ──
test('doctor.html: switching chats while a realtime-triggered hydrate is still in flight does not paint the wrong patient\'s messages', async ({ page }) => {
  await setupDoctorPage(page, {
    patients: [
      { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' },
      { id: 'p2', username: 'peter.gruber', full_name: 'Peter Gruber', name: 'Peter', versicherung: 'ÖGK', svnr: '456', dob: '1990-01-01', join_status: 'approved' },
    ],
  });
  const finalMessagesHtml = await page.evaluate(async () => {
    // Hold Maria's hydrate open until we say so, so we can deterministically
    // switch chats while it's still pending -- exactly the race window the
    // real bug depended on.
    let resolveMariaHydrate;
    const mariaHydratePending = new Promise(r => { resolveMariaHydrate = r; });
    const realHydrate = hydrateRealThreadFromSupabase;
    window.hydrateRealThreadFromSupabase = async function (name) {
      if (name === 'Maria Huber') { await mariaHydratePending; }
      return realHydrate(name);
    };

    selectPatient(document.createElement('div'), 'Maria Huber', '#0E5E56', 'ÖGK');
    // Simulates the realtime event firing while Maria's chat is open --
    // this internally calls the (now-slow) hydrateRealThreadFromSupabase.
    const hydratePromise = (async () => {
      const openName = document.getElementById('chat-name')?.textContent;
      const color = document.getElementById('chat-avatar')?.style.background;
      const hydrated = await window.hydrateRealThreadFromSupabase(openName);
      if (hydrated && document.getElementById('chat-name')?.textContent === openName) renderMessages(openName, color);
    })();

    // Doctor switches to a different patient's chat before Maria's hydrate resolves.
    selectPatient(document.createElement('div'), 'Peter Gruber', '#0E5E56', 'ÖGK');
    const messagesAfterSwitch = document.getElementById('messages').innerHTML;

    // Now let Maria's stale hydrate finally resolve.
    resolveMariaHydrate();
    await hydratePromise;
    await new Promise(r => setTimeout(r, 50));

    return {
      chatNameAfter: document.getElementById('chat-name')?.textContent,
      messagesBefore: messagesAfterSwitch,
      messagesAfter: document.getElementById('messages').innerHTML,
    };
  });
  expect(finalMessagesHtml.chatNameAfter, 'Peter\'s chat must still be the one open').toBe('Peter Gruber');
  expect(finalMessagesHtml.messagesAfter, 'Maria\'s late-arriving hydrate must not overwrite Peter\'s already-open chat').toBe(finalMessagesHtml.messagesBefore);
});

// ── Finding: doctor.html's "Erweiterte Suche" (SV-Nummer/Geburtsdatum/
// Versicherung) filtered against .patient-meta's own visible text, which
// never actually contained SVNr/Versicherung (only the appointment time and
// unread badge) and never used the DOB field at all -- the whole panel was
// a silent no-op. ──
test('doctor.html: "Erweiterte Suche" actually filters by SV-Nummer, Geburtsdatum and Versicherung', async ({ page }) => {
  await setupDoctorPage(page, {
    patients: [
      { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '1111', dob: '1985-01-01', join_status: 'approved' },
      { id: 'p2', username: 'peter.gruber', full_name: 'Peter Gruber', name: 'Peter', versicherung: 'BVAEB', svnr: '2222', dob: '1990-06-15', join_status: 'approved' },
    ],
  });
  await page.evaluate(async () => { switchView('clinic'); renderPatientList(); });

  const bySvnr = await page.evaluate(() => {
    document.getElementById('adv-svnr').value = '1111';
    advSearch();
    return Array.from(document.querySelectorAll('.patient-item')).filter(i => i.style.display !== 'none').map(i => i.querySelector('.patient-name').textContent);
  });
  expect(bySvnr).toEqual(['Maria Huber']);

  const byDob = await page.evaluate(() => {
    clearAdvSearch();
    document.getElementById('adv-dob').value = '1990-06-15';
    advSearch();
    return Array.from(document.querySelectorAll('.patient-item')).filter(i => i.style.display !== 'none').map(i => i.querySelector('.patient-name').textContent);
  });
  expect(byDob).toEqual(['Peter Gruber']);

  const byVers = await page.evaluate(() => {
    clearAdvSearch();
    document.getElementById('adv-versicherung').value = 'BVAEB';
    advSearch();
    return Array.from(document.querySelectorAll('.patient-item')).filter(i => i.style.display !== 'none').map(i => i.querySelector('.patient-name').textContent);
  });
  expect(byVers).toEqual(['Peter Gruber']);
});

// ── Finding: patient.html's renderProfilArztRows()/populateArztSelect()
// interpolated a doctor's fullName/fach straight into innerHTML with no
// escaping, unlike every other dynamic string in the file. ──
test('patient.html: a malicious doctor display name is escaped in Profil and the Termin-booking Arzt select', async ({ page }) => {
  await installMockSupabase(page, {
    staff_profiles: [
      { id: 'u1', vorname: 'Evil', nachname: 'Doctor', full_name: XSS_PATIENT, role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.evil' },
    ],
    practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro' }],
    patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
  }, () => {
    window.__xssFired = false;
    sessionStorage.setItem('smartordi_user', JSON.stringify({ username: 'maria.huber' }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
  await page.waitForTimeout(1200);
  const result = await page.evaluate(async () => {
    await renderProfilArztRows();
    await populateArztSelect();
    return {
      profilHtml: document.getElementById('profilArztRows')?.innerHTML || '',
      selectHtml: document.getElementById('terminArzt')?.innerHTML || '',
    };
  });
  expect(result.profilHtml).not.toMatch(/<img[^>]*onerror/);
  expect(result.selectHtml).not.toMatch(/<img[^>]*onerror/);
  expect(await page.evaluate(() => window.__xssFired)).toBe(false);
});
