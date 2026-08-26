// Regression test for the render-time translation of FIXED/system chat
// messages (supabase/phase83_patient_message_translations.sql) -- real user
// request (2026-08-20): "the fixed messages that arrive in the patient's
// chat should arrive translated according to the language the patient
// selects". Before this, every one of the 6 message senders below baked an
// already-rendered GERMAN sentence straight into `patient_messages.text`,
// so a patient using the app in English/Arabic/Turkish/Bosnian still saw
// German system messages forever, regardless of their own language choice.
//
// phase84_more_message_translations.sql (2026-08-26, real user report:
// "الرسايل لسة بتوصل الماني حتى لما بغير اللغة" -- still arriving in German
// even after changing the language) added 3 more fixed/system messages that
// phase83's original sweep missed entirely: send_termine_reminders() (a
// pg_cron job, server-side only -- see that migration's own header for why
// it was invisible to a grep of *.html/vendor/*.js), notifyNextWaitingPatient()
// (vendor/patient-data.js), and sendRecallReminder() (secretary.html).
//
// A second follow-up report the same day ("الرسايل لسة الماني ... بعتت رسالة
// اوبرفايزونج و لسة عنوانها بالالماني") found a whole separate CATEGORY that
// was missed: "uw" (document) chat messages -- the header/sub shown above a
// Rezept/Überweisung/Pflegefreistellung/Arbeitsunfähigkeit PDF bubble
// (vendor/kartei-rezept-ueberweisung.js, vendor/kartei-atteste.js). The
// original sweep only ever looked at type:'text' messages; msgRowHtml()'s
// 'uw' branch never checked msgKey at all. Reuses the SAME msg_key/
// msg_params columns (no new migration needed) -- patient.html's
// renderUwSub() (vendor/i18n-patient.js) derives the translated sub-line
// from the same msgKey/msgParams the header uses. isRenewableDocument()/
// requestDocumentRenewal() deliberately keep matching/reusing the RAW
// (always-German) m.text unchanged -- that's the outgoing renewal request
// text the PATIENT sends TO staff, who always see German regardless of the
// patient's own language, same as every other staff-facing text in this app.
//
// Design (see vendor/i18n-patient.js's own comments for the full reasoning):
// each sender now ALSO writes a language-neutral `msg_key` + `msg_params`
// (raw ISO dates, plain display-name strings, raw categorical values --
// never pre-formatted dates or pre-built sentence fragments) alongside the
// unchanged German `text` fallback. patient.html's msgRowHtml() re-renders
// via renderSystemMessage(key,params) at RENDER time, in whatever language
// is CURRENTLY selected on the patient's own device -- never at send time,
// since the staff device sending the message has no idea what language the
// patient will pick, and it can change later.
//
// Covers, per sender: that msg_key/msg_params actually reach the
// patient_messages row with the right raw (untranslated, unformatted)
// values. Covers, for rendering: German output is byte-identical to the
// old hardcoded strings (no regression for the overwhelming majority of
// real patients, who use the app in German), a second language actually
// differs and contains the right translated substrings, and the `text`
// fallback still renders unchanged for any message with no msg_key (a
// patient's own free-typed reply, staff's own free-typed message, or any
// message sent before this feature shipped).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');
const { installJsPdfMock } = require('./helpers/jspdfStub');

// ---------------------------------------------------------------------
// Part 1: doctor.html senders persist the right msg_key/msg_params
// ---------------------------------------------------------------------
test.describe('doctor.html system-message senders write msg_key/msg_params', () => {
  function seed() {
    return {
      // staff_profiles.id doubles as loadStaffAccounts()'s (vendor/staff-
      // accounts.js) roster key -- arztDisplayName(username), which
      // confirmTransfer() below needs to build a real doctor name, looks a
      // colleague up BY that id. Using the same string for both id and
      // username here (unlike some other tests' 'u1'/'u2' ids) keeps that
      // lookup resolvable with transferSelectedDoctor set directly, the way
      // the real UI's renderTransferPanel()/selectTransferDoctor() flow
      // (which stores a colleague's id under the confusingly-named
      // 'username' field) already does in production.
      staff_profiles: [
        { id: 'dr.ahmed', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' },
        { id: 'dr.berger', vorname: 'Jonas', nachname: 'Berger', full_name: 'Dr. Jonas Berger', role: 'arzt', fach: 'Kardiologie', is_admin: false, email: 'j@a.at', username: 'dr.berger' },
      ],
      practice_settings: [{ id: true }],
      patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
      termine: [{ id: 't1', patient_name: 'Maria Huber', arzt_id: 'dr.ahmed', status: 'bestaetigt', date: '2026-08-01', time: '09:00' }],
    };
  }

  async function setupPage(page) {
    await installMockSupabase(page, seed(), () => {
      sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
      localStorage.setItem('smartordi_patient_accounts', JSON.stringify({
        'maria.huber': { pw: '', name: 'Maria', fullName: 'Maria Huber', id: 'p1', messages: [] },
      }));
      localStorage.setItem('smartordi_staff_accounts', JSON.stringify({
        'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' },
        'dr.berger': { username: 'dr.berger', fullName: 'Dr. Jonas Berger', role: 'arzt', isAdmin: false, fach: 'Kardiologie' },
      }));
    });
    await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
    await page.waitForTimeout(1200);
    await page.evaluate(async () => { await Promise.all([staffRosterReady, termineReady, patientsReady, vertretungReady]); });
  }

  test('sendVertretungBroadcast() writes chat.system.vertretung with raw von/bis and a contact string', async ({ page }) => {
    await setupPage(page);
    const result = await page.evaluate(async () => {
      document.getElementById('vertVon').value = '2026-08-01';
      document.getElementById('vertBis').value = '2026-08-10';
      document.getElementById('vertName').value = 'Dr. Extern';
      document.getElementById('vertFach').value = 'Allgemeinmedizin';
      document.getElementById('vertAdresse').value = 'Externstr 1';
      vertretungMode = 'external';
      await sendVertretungBroadcast();
      await new Promise(r => setTimeout(r, 100));
      const row = window.__store.patient_messages.find(m => m.msg_key === 'chat.system.vertretung');
      return row ? { msgKey: row.msg_key, msgParams: row.msg_params, text: row.text } : null;
    });
    expect(result).not.toBeNull();
    expect(result.msgParams.von).toBe('2026-08-01'); // raw ISO, not the German-formatted vonFmt
    expect(result.msgParams.bis).toBe('2026-08-10');
    expect(result.msgParams.substituteName).toBe('Dr. Extern');
    expect(result.msgParams.contact).toContain('Externstr 1');
    expect(result.text).toContain('Dr. Extern'); // German fallback still built exactly as before
  });

  test('sendAddressChangeBroadcast() writes chat.system.addressChange with the raw address', async ({ page }) => {
    await setupPage(page);
    const result = await page.evaluate(async () => {
      document.getElementById('setAdresse').value = 'Neue Str 5, Wien';
      await sendAddressChangeBroadcast();
      await new Promise(r => setTimeout(r, 100));
      const row = window.__store.patient_messages.find(m => m.msg_key === 'chat.system.addressChange');
      return row ? { msgParams: row.msg_params, text: row.text } : null;
    });
    expect(result).not.toBeNull();
    expect(result.msgParams.address).toBe('Neue Str 5, Wien');
    expect(result.text).toContain('Neue Str 5, Wien');
  });

  test('confirmTransfer() writes chat.system.transferred with the raw doctor name and note', async ({ page }) => {
    await setupPage(page);
    const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    const result = await page.evaluate(async (d1) => {
      window.__store.termine = [{ id: 't1', patient_name: 'Maria Huber', arzt_id: 'dr.ahmed', status: 'bestaetigt', date: d1, time: '09:00' }];
      transferPatientForModal = 'Maria Huber';
      transferSelectedDoctor = 'dr.berger';
      document.getElementById('transferNote').value = 'wichtige Notiz';
      await confirmTransfer();
      await new Promise(r => setTimeout(r, 100));
      const row = window.__store.patient_messages.find(m => m.msg_key === 'chat.system.transferred');
      return row ? { msgParams: row.msg_params, text: row.text } : null;
    }, inDays(1));
    expect(result).not.toBeNull();
    expect(result.msgParams.doctorName).toBe('Dr. Jonas Berger');
    expect(result.msgParams.note).toBe('wichtige Notiz');
    expect(result.text).toContain('Dr. Jonas Berger');
  });
});

// ---------------------------------------------------------------------
// Part 1b: notifyNextWaitingPatient() (vendor/patient-data.js) -- one of the
// 3 messages missed by phase83's original sweep, closed by phase84.
// ---------------------------------------------------------------------
test.describe('notifyNextWaitingPatient() writes msg_key/msg_params', () => {
  async function setupPage(page) {
    await installMockSupabase(page, {
      staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
      practices: [{ id: 'prac1' }],
      patients: [
        { id: 'p1', username: 'karl.gruber', full_name: 'Karl Gruber', name: 'Karl', versicherung: 'ÖGK', svnr: '456', dob: '1970-02-02', join_status: 'approved' },
        { id: 'p2', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'BVAEB', svnr: '789', dob: '1985-05-05', join_status: 'approved' },
      ],
      termine: [
        { id: 't1', patient_id: 'p1', patient_name: 'Karl Gruber', art: 'Kontrolle', date: '2026-08-05', time: '13:00', end_time: '13:20', status: 'neu', arzt_id: 'u1', created_at: new Date().toISOString() },
        { id: 't2', patient_id: 'p2', patient_name: 'Maria Huber', art: 'Kontrolle', date: '2026-08-05', time: '13:20', end_time: '13:40', status: 'neu', arzt_id: 'u1', created_at: new Date().toISOString() },
      ],
    }, () => {
      sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
      localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
      localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
    });
    await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
    await page.waitForTimeout(1200);
    await page.evaluate(async () => { await Promise.all([patientsReady, termineReady]); });
  }

  test('starting a visit writes chat.system.turnApproaching with no dynamic params', async ({ page }) => {
    await setupPage(page);
    const result = await page.evaluate(async () => {
      await startTerminVisit('t1');
      await new Promise(r => setTimeout(r, 100));
      const row = window.__store.patient_messages.find(m => m.msg_key === 'chat.system.turnApproaching');
      return row ? { msgParams: row.msg_params, text: row.text } : null;
    });
    expect(result).not.toBeNull();
    expect(result.text).toContain('Praxis kommen'); // German fallback unchanged
  });
});

// ---------------------------------------------------------------------
// Part 2: secretary.html Termin senders persist the right msg_key/msg_params
// ---------------------------------------------------------------------
test.describe('secretary.html Termin senders write msg_key/msg_params', () => {
  function baseSeed(terminOverrides) {
    return {
      staff_profiles: [
        { id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' },
      ],
      practice_settings: [{ id: true }],
      patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' }],
      termine: [Object.assign({
        id: 't1', patient_id: 'p1', patient_name: 'Maria Huber', art: 'Kontrolle',
        date: '2026-08-15', time: '09:30', end_time: '10:00', status: 'neu', arzt_id: 'u1',
        created_at: new Date().toISOString(),
      }, terminOverrides)],
    };
  }

  async function setupPage(page, terminOverrides) {
    await installMockSupabase(page, baseSeed(terminOverrides), () => {
      sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
      localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
      localStorage.setItem('smartordi_staff_accounts', JSON.stringify({
        'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' },
      }));
    });
    await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
    await page.waitForTimeout(1200);
    await page.evaluate(async () => { await Promise.all([patientsReady, termineReady]); });
  }

  test('confirmTermin() writes chat.system.terminConfirmed with raw date/doctor/art', async ({ page }) => {
    await setupPage(page);
    const result = await page.evaluate(async () => {
      await confirmTermin('t1');
      await new Promise(r => setTimeout(r, 100));
      const msgs = findPatientByFullName('Maria Huber').accounts['maria.huber'].messages;
      return msgs[0];
    });
    expect(result.msgKey).toBe('chat.system.terminConfirmed');
    expect(result.msgParams.date).toBe('2026-08-15'); // raw ISO, not "15. August 2026"
    expect(result.msgParams.doctor).toBe('Dr. Sarah Ahmed');
    expect(result.msgParams.art).toBe('Kontrolle');
    expect(result.msgParams.time).toContain('09:30');
    expect(result.text).toContain('bestätigt'); // German fallback unchanged
  });

  test('cancelTermin() writes chat.system.terminCancelled with the raw date/time', async ({ page }) => {
    await setupPage(page, { status: 'bestaetigt' });
    const result = await page.evaluate(async () => {
      await cancelTermin('t1');
      await new Promise(r => setTimeout(r, 100));
      const msgs = findPatientByFullName('Maria Huber').accounts['maria.huber'].messages;
      return msgs[0];
    });
    expect(result.msgKey).toBe('chat.system.terminCancelled');
    expect(result.msgParams.date).toBe('2026-08-15');
    expect(result.text).toContain('abgesagt');
  });

  test('confirmMove() writes chat.system.terminMoved with the new raw date/time', async ({ page }) => {
    await setupPage(page);
    const result = await page.evaluate(async () => {
      openMoveModal('t1');
      document.getElementById('moveDate').value = '2026-08-20';
      document.getElementById('moveNewTime').value = '14:00';
      document.getElementById('moveNewEndTime').value = '14:30';
      await confirmMove();
      await new Promise(r => setTimeout(r, 100));
      const msgs = findPatientByFullName('Maria Huber').accounts['maria.huber'].messages;
      return msgs[0];
    });
    expect(result.msgKey).toBe('chat.system.terminMoved');
    expect(result.msgParams.date).toBe('2026-08-20'); // raw ISO for the NEW date
    expect(result.msgParams.time).toBe('14:00–14:30');
    expect(result.text).toContain('verschoben');
  });

  // Part 2b: sendRecallReminder() -- the other message missed by phase83's
  // original sweep, closed by phase84.
  test('sendRecallReminder() writes chat.system.recallReminder with the raw name/label/monthsSince', async ({ page }) => {
    await setupPage(page);
    const result = await page.evaluate(async () => {
      sendRecallReminder('Maria Huber', 'Diabetes', 8);
      await new Promise(r => setTimeout(r, 100));
      const msgs = findPatientByFullName('Maria Huber').accounts['maria.huber'].messages;
      return msgs[0];
    });
    expect(result.msgKey).toBe('chat.system.recallReminder');
    expect(result.msgParams.name).toBe('Maria Huber');
    expect(result.msgParams.label).toBe('Diabetes'); // raw categorical value, same as `art`/doctor names elsewhere
    expect(result.msgParams.monthsSince).toBe(8);
    expect(result.text).toContain('Kontrolluntersuchung');
  });
});

// ---------------------------------------------------------------------
// Part 2c: the 4 "uw" (document) senders write msg_key/msg_params -- the
// second category phase83 missed entirely (see the file header).
// ---------------------------------------------------------------------
test.describe('doctor.html "uw" document senders write msg_key/msg_params', () => {
  function seed() {
    return {
      staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
      practices: [{ id: 'prac1', name: 'Musterordination', plan: 'pro', adresse: 'Hauptstraße 1, 4020 Linz' }],
      patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', adresse: 'Bahnhofstraße 5, 4020 Linz', join_status: 'approved' }],
    };
  }

  async function setupPage(page, tab) {
    await installJsPdfMock(page);
    await installMockSupabase(page, seed(), () => {
      sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
      localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
      localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
    });
    await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
    await page.waitForTimeout(1200);
    await page.evaluate(async (t) => {
      await Promise.all([patientsReady, practiceSettingsReady, staffRosterReady]);
      switchView('clinic');
      toggleKartei();
      document.getElementById('kartei-name').textContent = 'Maria Huber';
      document.getElementById('kartei-meta').textContent = 'ÖGK · SV 123';
      switchKarteiTab(t, document.querySelector(`.kartei-tab[onclick*="${t}"]`));
    }, tab);
  }

  test('sendPflegefreistellungToChat() writes chat.uw.pflegefreistellung with no dynamic params', async ({ page }) => {
    await setupPage(page, 'pflegefreistellung');
    await page.fill('#pf-antragsteller', 'Johann Huber');
    await page.fill('#pf-verwandtschaft', 'Ehepartner');
    await page.fill('#pf-von', '2026-08-10');
    await page.fill('#pf-bis', '2026-08-12');
    const result = await page.evaluate(async () => {
      await sendPflegefreistellungToChat();
      await new Promise(r => setTimeout(r, 100));
      const row = window.__store.patient_messages.find(m => m.msg_key === 'chat.uw.pflegefreistellung');
      return row ? { text: row.text, doc_sub: row.doc_sub } : null;
    });
    expect(result).not.toBeNull();
    expect(result.text).toBe('Bestätigung: Pflegefreistellung ausgestellt'); // German fallback unchanged
  });

  test('sendArbeitsunfaehigkeitToChat() writes chat.uw.attest with no dynamic params', async ({ page }) => {
    await setupPage(page, 'arbeitsunfaehigkeit');
    await page.fill('#au2-von', '2026-08-05');
    await page.fill('#au2-bis', '2026-08-09');
    const result = await page.evaluate(async () => {
      await sendArbeitsunfaehigkeitToChat();
      await new Promise(r => setTimeout(r, 100));
      const row = window.__store.patient_messages.find(m => m.msg_key === 'chat.uw.attest');
      return row ? { text: row.text } : null;
    });
    expect(result).not.toBeNull();
    expect(result.text).toBe('Arbeitsunfähigkeitsmeldung ausgestellt');
  });

  test('handleUwSend() (Überweisung) writes chat.uw.ueberweisung with the raw an/fach/dring', async ({ page }) => {
    await setupPage(page, 'ueberweisung');
    await page.fill('#uwAn', 'Dr. Klaus Weber');
    await page.selectOption('#uwFach', 'Kardiologie');
    await page.selectOption('#uwDring', 'Dringend');
    const result = await page.evaluate(async () => {
      await handleUwSend();
      await new Promise(r => setTimeout(r, 100));
      const row = window.__store.patient_messages.find(m => m.msg_key === 'chat.uw.ueberweisung');
      return row ? { msgParams: row.msg_params, text: row.text } : null;
    });
    expect(result).not.toBeNull();
    expect(result.msgParams.an).toBe('Dr. Klaus Weber');
    expect(result.msgParams.fach).toBe('Kardiologie'); // raw categorical value, not translated further
    expect(result.msgParams.dring).toBe('Dringend');
    expect(result.text).toContain('Dr. Klaus Weber');
  });

  test('sendRezeptToChat() writes chat.uw.rezept with the raw medication summary', async ({ page }) => {
    await setupPage(page, 'rezept');
    await page.fill('#rz-med1', 'Amoxicillin 500mg');
    await page.fill('#rz-dose1', '3x täglich');
    const result = await page.evaluate(async () => {
      await sendRezeptToChat();
      await new Promise(r => setTimeout(r, 100));
      const row = window.__store.patient_messages.find(m => m.msg_key === 'chat.uw.rezept');
      return row ? { msgParams: row.msg_params, text: row.text } : null;
    });
    expect(result).not.toBeNull();
    expect(result.msgParams.summary).toContain('Amoxicillin 500mg');
    expect(result.text).toContain('Amoxicillin 500mg');
  });
});

// ---------------------------------------------------------------------
// Part 3: patient.html renders msgRowHtml()/renderSystemMessage() correctly
// ---------------------------------------------------------------------
test.describe('patient.html renders system chat messages in the patient\'s selected language', () => {
  async function setupPage(page, lang) {
    await installMockSupabase(page, {
      patients: [{ id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', join_status: 'approved' }],
    }, () => {
      sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'patient', name: 'Maria', username: 'maria.huber' }));
      localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    });
    await page.goto('file://' + path.join(__dirname, '..', 'patient.html'));
    await page.waitForTimeout(1200);
    // getPatientLang()/msgRowHtml() read this at CALL time, not load time --
    // setting it after navigation (rather than fighting installMockSupabase's
    // extraInit closure, which cannot reference outer Node.js variables) is
    // both simpler and correctly models a patient who already picked a
    // language before this chat message was ever rendered.
    if (lang) await page.evaluate((l) => localStorage.setItem('smartordi_patient_lang', l), lang);
  }

  test('German rendering of chat.system.terminConfirmed is byte-identical to the old hardcoded sentence', async ({ page }) => {
    await setupPage(page);
    const html = await page.evaluate(() => msgRowHtml({
      dir: 'in', type: 'text', time: '10:00',
      msgKey: 'chat.system.terminConfirmed',
      msgParams: { doctor: 'Dr. Sarah Ahmed', date: '2026-08-15', time: '09:30–10:00', art: 'Kontrolle' },
    }));
    expect(html).toContain('✓ Ihr Termin bei Dr. Sarah Ahmed wurde bestätigt: 15. August 2026, 09:30–10:00 Uhr · Kontrolle.');
  });

  test('German rendering of chat.system.vertretung is byte-identical to the old hardcoded sentence', async ({ page }) => {
    await setupPage(page);
    const html = await page.evaluate(() => msgRowHtml({
      dir: 'in', type: 'text', time: '10:00',
      msgKey: 'chat.system.vertretung',
      msgParams: { myName: 'Dr. Sarah Ahmed', von: '2026-08-01', bis: '2026-08-10', substituteName: 'Dr. Extern', contact: 'Allgemeinmedizin · Externstr 1' },
    }));
    expect(html).toContain('ℹ Wichtiger Hinweis: Dr. Sarah Ahmed ist von 1. August 2026 bis 10. August 2026 abwesend. In dieser Zeit vertritt Sie: Dr. Extern (Allgemeinmedizin · Externstr 1).');
  });

  test('German rendering of chat.system.transferred (no note) omits the note part entirely', async ({ page }) => {
    await setupPage(page);
    const html = await page.evaluate(() => msgRowHtml({
      dir: 'in', type: 'text', time: '10:00',
      msgKey: 'chat.system.transferred',
      msgParams: { doctorName: 'Dr. Jonas Berger', note: null },
    }));
    expect(html).toContain('↪ Sie wurden an Dr. Jonas Berger weitergeleitet.');
    expect(html).not.toContain('Notiz');
  });

  test('English rendering translates the same message and differs from German', async ({ page }) => {
    await setupPage(page, 'en');
    const html = await page.evaluate(() => msgRowHtml({
      dir: 'in', type: 'text', time: '10:00',
      msgKey: 'chat.system.terminConfirmed',
      msgParams: { doctor: 'Dr. Sarah Ahmed', date: '2026-08-15', time: '09:30–10:00', art: 'Kontrolle' },
    }));
    expect(html).toContain('Your appointment with Dr. Sarah Ahmed has been confirmed: 15. August 2026, 09:30–10:00');
    expect(html).not.toContain('Ihr Termin');
  });

  test('Arabic rendering translates chat.system.addressChange', async ({ page }) => {
    await setupPage(page, 'ar');
    const html = await page.evaluate(() => msgRowHtml({
      dir: 'in', type: 'text', time: '10:00',
      msgKey: 'chat.system.addressChange',
      msgParams: { address: 'Neue Str 5, Wien' },
    }));
    expect(html).toContain('انتقلت عيادتنا إلى مكان جديد');
    expect(html).toContain('Neue Str 5, Wien');
  });

  // phase84 -- the 3 messages missed by phase83's original sweep.
  test('German rendering of chat.system.terminReminder (send_termine_reminders() cron job) is byte-identical to the old hardcoded sentence', async ({ page }) => {
    await setupPage(page);
    const html = await page.evaluate(() => msgRowHtml({
      dir: 'in', type: 'text', time: '10:00',
      msgKey: 'chat.system.terminReminder',
      msgParams: { time: '09:30', art: 'Kontrolle' },
    }));
    expect(html).toContain('Erinnerung: Sie haben morgen um 09:30 Uhr einen Termin (Kontrolle) bei uns. Bei Verhinderung bitte rechtzeitig absagen.');
  });

  test('German rendering of chat.system.turnApproaching (notifyNextWaitingPatient()) is byte-identical to the old hardcoded sentence', async ({ page }) => {
    await setupPage(page);
    const html = await page.evaluate(() => msgRowHtml({
      dir: 'in', type: 'text', time: '10:00',
      msgKey: 'chat.system.turnApproaching',
      msgParams: {},
    }));
    expect(html).toContain('🕒 Der Termin vor dir hat gerade begonnen — du kannst jetzt langsam in die Praxis kommen.');
  });

  test('German rendering of chat.system.recallReminder (sendRecallReminder()) is byte-identical to the old hardcoded sentence', async ({ page }) => {
    await setupPage(page);
    const html = await page.evaluate(() => msgRowHtml({
      dir: 'in', type: 'text', time: '10:00',
      msgKey: 'chat.system.recallReminder',
      msgParams: { name: 'Maria Huber', label: 'Diabetes', monthsSince: 8 },
    }));
    expect(html).toContain('Guten Tag Maria Huber! Laut unseren Unterlagen wäre bei Ihnen eine Kontrolluntersuchung (Diabetes) fällig — Ihr letzter Eintrag liegt 8 Monate zurück. Bitte vereinbaren Sie bei Gelegenheit einen Termin.');
  });

  test('English rendering translates chat.system.terminReminder and chat.system.turnApproaching', async ({ page }) => {
    await setupPage(page, 'en');
    const reminderHtml = await page.evaluate(() => msgRowHtml({
      dir: 'in', type: 'text', time: '10:00',
      msgKey: 'chat.system.terminReminder',
      msgParams: { time: '09:30', art: 'Kontrolle' },
    }));
    const turnHtml = await page.evaluate(() => msgRowHtml({
      dir: 'in', type: 'text', time: '10:00',
      msgKey: 'chat.system.turnApproaching',
      msgParams: {},
    }));
    expect(reminderHtml).toContain('Reminder: you have an appointment tomorrow at 09:30 (Kontrolle)');
    expect(reminderHtml).not.toContain('Erinnerung');
    expect(turnHtml).toContain('The appointment before yours has just begun');
    expect(turnHtml).not.toContain('Der Termin vor dir');
  });

  // Part 2c's "uw" (document) header/sub -- the second category phase83
  // missed entirely (see the file header).
  test('German rendering of a "uw" bubble (chat.uw.ueberweisung) is byte-identical to the old hardcoded header/sub', async ({ page }) => {
    await setupPage(page);
    const html = await page.evaluate(() => msgRowHtml({
      dir: 'out', type: 'uw', time: '10:00', filename: 'Ueberweisung.pdf',
      text: 'Überweisung → Dr. Klaus Weber (Kardiologie) · Dringend', // raw fallback, unchanged
      sub: 'Kardiologie · Dringend',
      msgKey: 'chat.uw.ueberweisung',
      msgParams: { an: 'Dr. Klaus Weber', fach: 'Kardiologie', dring: 'Dringend' },
    }));
    expect(html).toContain('Überweisung → Dr. Klaus Weber (Kardiologie) · Dringend');
    expect(html).toContain('Kardiologie · Dringend');
  });

  test('English rendering of a "uw" bubble translates chat.uw.attest header and sub', async ({ page }) => {
    await setupPage(page, 'en');
    const html = await page.evaluate(() => msgRowHtml({
      dir: 'out', type: 'uw', time: '10:00', filename: 'Attest.pdf',
      text: 'Arbeitsunfähigkeitsmeldung ausgestellt', sub: 'Krankenstandsbestätigung',
      msgKey: 'chat.uw.attest', msgParams: {},
    }));
    expect(html).toContain('Sick note issued');
    expect(html).toContain('Sick note confirmation');
    // The raw German m.text DOES still appear once, inside the renewal
    // button's onclick -- by design (see the file header): that's the
    // outgoing request text sent TO staff, always German regardless of the
    // patient's own language, not something the patient reads. Only the
    // VISIBLE bubble content (before the button) must not show it.
    const bubbleOnly = html.slice(0, html.indexOf('uw-renew-btn'));
    expect(bubbleOnly).not.toContain('Arbeitsunfähigkeitsmeldung');
  });

  test('a "uw" message with no msgKey still falls back to the raw text/sub columns unchanged', async ({ page }) => {
    await setupPage(page, 'en'); // even in a non-German language
    const html = await page.evaluate(() => msgRowHtml({
      dir: 'out', type: 'uw', time: '10:00', filename: 'Rezept.pdf',
      text: 'Rezept ausgestellt · Ibuprofen 400mg', sub: 'Kassenrezept',
    }));
    expect(html).toContain('Rezept ausgestellt · Ibuprofen 400mg');
    expect(html).toContain('Kassenrezept');
  });

  test('a message with no msgKey still falls back to the plain text column unchanged (free-typed / pre-feature messages)', async ({ page }) => {
    await setupPage(page, 'en'); // even in a non-German language
    const html = await page.evaluate(() => msgRowHtml({
      dir: 'in', type: 'text', time: '10:00', text: 'Guten Tag, wie kann ich helfen?',
    }));
    expect(html).toContain('Guten Tag, wie kann ich helfen?');
  });
});
