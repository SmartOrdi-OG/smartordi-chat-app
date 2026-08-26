// Regression test for the render-time translation of FIXED/system chat
// messages (supabase/phase83_patient_message_translations.sql) -- real user
// request (2026-08-20): "the fixed messages that arrive in the patient's
// chat should arrive translated according to the language the patient
// selects". Before this, every one of the 6 message senders below baked an
// already-rendered GERMAN sentence straight into `patient_messages.text`,
// so a patient using the app in English/Arabic/Turkish/Bosnian still saw
// German system messages forever, regardless of their own language choice.
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

  test('a message with no msgKey still falls back to the plain text column unchanged (free-typed / pre-feature messages)', async ({ page }) => {
    await setupPage(page, 'en'); // even in a non-German language
    const html = await page.evaluate(() => msgRowHtml({
      dir: 'in', type: 'text', time: '10:00', text: 'Guten Tag, wie kann ich helfen?',
    }));
    expect(html).toContain('Guten Tag, wie kann ich helfen?');
  });
});
