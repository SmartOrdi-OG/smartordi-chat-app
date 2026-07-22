// Regression test for the Vertretung (absence/substitute-doctor notice)
// feature in doctor.html -- saveVertretung()/sendVertretungBroadcast() had
// no committed test coverage at all, despite writing to a real Supabase
// table (practice_vertretung) and broadcasting a message to every one of
// the doctor's patients. Covers: required-field validation before any
// write happens, that a later save doesn't clobber a prior broadcast's
// sent_to/sent_at (Supabase's upsert only touches columns actually sent),
// and that the broadcast only ever messages patients who still have a real
// account -- a stale Termin for a deleted/renamed patient must not count.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patients: [
      { id: 'p1', username: 'maria.huber', full_name: 'Maria Huber', name: 'Maria', versicherung: 'ÖGK', svnr: '123', dob: '1985-01-01', join_status: 'approved' },
    ],
    termine: [
      { id: 't1', patient_name: 'Maria Huber', arzt_id: 'dr.ahmed', status: 'bestaetigt', date: '2026-08-01', time: '09:00' },
      // A stale Termin for a patient who no longer has a real account (e.g.
      // deleted directly in the Supabase table editor) -- must be excluded.
      { id: 't2', patient_name: 'Ghost Patient', arzt_id: 'dr.ahmed', status: 'bestaetigt', date: '2026-08-02', time: '10:00' },
    ],
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
    }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { await Promise.all([staffRosterReady, termineReady, patientsReady, vertretungReady]); });
}

test('saveVertretung() refuses to save without a Von/Bis date, and writes nothing', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('vertVon').value = '';
    document.getElementById('vertBis').value = '';
    vertretungMode = 'external';
    document.getElementById('vertName').value = 'Dr. Extern';
    await saveVertretung();
    await new Promise(r => setTimeout(r, 100));
    return { toastText: document.getElementById('toast')?.textContent || '', rows: window.__store.practice_vertretung.length };
  });
  expect(result.toastText).toContain('Von/Bis-Datum');
  expect(result.rows).toBe(0);
});

test('saveVertretung() refuses external mode without a substitute name', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('vertVon').value = '2026-08-01';
    document.getElementById('vertBis').value = '2026-08-10';
    vertretungMode = 'external';
    document.getElementById('vertName').value = '';
    await saveVertretung();
    await new Promise(r => setTimeout(r, 100));
    return { toastText: document.getElementById('toast')?.textContent || '', rows: window.__store.practice_vertretung.length };
  });
  expect(result.toastText).toContain('Namen des Vertretungsarztes');
  expect(result.rows).toBe(0);
});

test('a later saveVertretung() call does not clobber a prior broadcast\'s sent_to/sent_at', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('vertVon').value = '2026-08-01';
    document.getElementById('vertBis').value = '2026-08-10';
    document.getElementById('vertName').value = 'Dr. Extern';
    document.getElementById('vertFach').value = 'Allgemeinmedizin';
    document.getElementById('vertAdresse').value = 'Externstr 1';
    document.getElementById('vertTel').value = '+43 1 2345';
    document.getElementById('vertEmail').value = 'extern@example.at';
    vertretungMode = 'external';
    await sendVertretungBroadcast();
    await new Promise(r => setTimeout(r, 100));
    const afterBroadcast = window.__store.practice_vertretung.find(v => v.arzt_id === 'dr.ahmed');

    // Now just extend the date range and save again (no re-broadcast).
    document.getElementById('vertBis').value = '2026-08-20';
    await saveVertretung();
    await new Promise(r => setTimeout(r, 100));
    const afterResave = window.__store.practice_vertretung.find(v => v.arzt_id === 'dr.ahmed');

    return {
      sentAtBefore: afterBroadcast.sent_at, sentToBefore: afterBroadcast.sent_to,
      sentAtAfter: afterResave.sent_at, sentToAfter: afterResave.sent_to,
      bisAfter: afterResave.bis,
    };
  });

  expect(result.sentToBefore).toEqual(['Maria Huber']);
  expect(result.bisAfter, 'the actual field being edited must still update').toBe('2026-08-20');
  expect(result.sentAtAfter, 'a plain save must not wipe a prior broadcast timestamp').toBe(result.sentAtBefore);
  expect(result.sentToAfter, 'a plain save must not wipe the prior broadcast recipient list').toEqual(result.sentToBefore);
});

test('sendVertretungBroadcast() only messages patients who still have a real account', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    document.getElementById('vertVon').value = '2026-08-01';
    document.getElementById('vertBis').value = '2026-08-10';
    document.getElementById('vertName').value = 'Dr. Extern';
    document.getElementById('vertFach').value = 'Allgemeinmedizin';
    vertretungMode = 'external';
    await sendVertretungBroadcast();
    await new Promise(r => setTimeout(r, 100));
    const row = window.__store.practice_vertretung.find(v => v.arzt_id === 'dr.ahmed');
    const mariaMessages = JSON.parse(localStorage.getItem('smartordi_patient_accounts'))['maria.huber'].messages;
    return {
      toastText: document.getElementById('toast')?.textContent || '',
      sentTo: row.sent_to,
      mariaGotMessage: mariaMessages.some(m => m.text.includes('Dr. Extern')),
    };
  });

  expect(result.sentTo, 'the ghost patient (no real account) must be excluded').toEqual(['Maria Huber']);
  expect(result.mariaGotMessage).toBe(true);
  expect(result.toastText).toContain('1 Patient/in(nen) benachrichtigt');
});
