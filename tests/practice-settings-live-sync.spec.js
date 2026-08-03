// Regression tests for a fresh audit finding: doctor.html's Adresse/Telefon/
// "Chat aktivieren" saves in Einstellungen gave zero feedback (success or
// failure) at all, and practice_settings (chat_enabled in particular) was
// never live-synced to an already-open doctor.html/secretary.html tab --
// a colleague's change (or this doctor's own save from another tab) stayed
// invisible until a manual reload.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed() {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'u1', practice_id: 'prac1' }],
    practices: [{ id: 'prac1', name: 'Ordination Dr. Ahmed', adresse: 'Alte Adresse 1, Linz', tel: '+43 1 111', chat_enabled: true, plan: 'pro', trial_start: '2026-01-01T00:00:00Z', payment_method: null, created_at: '2026-01-01T00:00:00Z' }],
  };
}

async function setupDoctor(page) {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'u1', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ u1: { username: 'u1', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
}

test('saveSinglePracticeField() shows a success toast when the save actually succeeds', async ({ page }) => {
  await setupDoctor(page);
  await page.evaluate(async () => {
    await practiceSettingsReady;
    const input = document.getElementById('setAdresse');
    input.value = 'Neue Adresse 9, Wien';
    await saveSinglePracticeField(input, 'adresse');
  });
  await expect(page.locator('#toast')).toHaveText('Gespeichert');
  const saved = await page.evaluate(() => window.__store.practices[0].adresse);
  expect(saved).toBe('Neue Adresse 9, Wien');
});

test('saveSinglePracticeField() shows a failure toast (not silence) when the save actually fails', async ({ page }) => {
  await setupDoctor(page);
  await page.evaluate(() => {
    window.__forceError = { practices: 'simulated db error' };
  });
  await page.evaluate(async () => {
    await practiceSettingsReady;
    const input = document.getElementById('setTel');
    input.value = '+43 660 000000';
    await saveSinglePracticeField(input, 'tel');
  });
  await expect(page.locator('#toast')).toHaveText('Speichern fehlgeschlagen: simulated db error');
});

test('toggleChatEnabledSetting() reverts the checkbox and shows a failure toast when the save fails', async ({ page }) => {
  await setupDoctor(page);
  await page.evaluate(() => {
    window.__forceError = { practices: 'simulated db error' };
  });
  const result = await page.evaluate(async () => {
    await practiceSettingsReady;
    const checkbox = document.getElementById('setChatEnabled');
    checkbox.checked = false;
    await toggleChatEnabledSetting(checkbox);
    return { checkedAfter: checkbox.checked, stillEnabled: isChatEnabled() };
  });
  expect(result.checkedAfter, 'a failed save must revert the checkbox back to the persisted value').toBe(true);
  expect(result.stillEnabled).toBe(true);
  await expect(page.locator('#toast')).toHaveText('Speichern fehlgeschlagen: simulated db error');
});

test('toggleChatEnabledSetting() persists and re-applies chat gating on success', async ({ page }) => {
  await setupDoctor(page);
  const result = await page.evaluate(async () => {
    await practiceSettingsReady;
    const checkbox = document.getElementById('setChatEnabled');
    checkbox.checked = false;
    await toggleChatEnabledSetting(checkbox);
    return {
      saved: window.__store.practices[0].chat_enabled,
      navLocked: document.getElementById('navTabPraxis')?.classList.contains('nav-tab-locked'),
    };
  });
  expect(result.saved).toBe(false);
  expect(result.navLocked).toBe(true);
  await expect(page.locator('#toast')).toHaveText('Gespeichert');
});

test('a practice_settings change from another tab (simulated realtime event) live-updates doctor.html without a reload', async ({ page }) => {
  await setupDoctor(page);
  const result = await page.evaluate(async () => {
    await practiceSettingsReady;
    // Simulate a COLLEAGUE's tab saving chat_enabled:false directly against
    // the shared store, bypassing this page's own savePracticeSettings() --
    // this page must find out only via the realtime channel, same as it
    // would from a real Postgres replication event.
    window.__store.practices[0].chat_enabled = false;
    window.__store.practices[0].adresse = 'Von Kollege geändert 3, Graz';
    await window.__realtimeHandlers['practice-settings-changes']();
    return {
      stillEnabled: isChatEnabled(),
      adresseInputValue: document.getElementById('setAdresse').value,
      navLocked: document.getElementById('navTabPraxis')?.classList.contains('nav-tab-locked'),
      chatCheckbox: document.getElementById('setChatEnabled').checked,
    };
  });
  expect(result.stillEnabled).toBe(false);
  expect(result.adresseInputValue).toBe('Von Kollege geändert 3, Graz');
  expect(result.navLocked).toBe(true);
  expect(result.chatCheckbox).toBe(false);
});

test('a live-synced update does not clobber an Adresse field the doctor is actively editing', async ({ page }) => {
  await setupDoctor(page);
  const result = await page.evaluate(async () => {
    await practiceSettingsReady;
    // The field has to actually be visible to receive real focus --
    // Einstellungen is just another .view, hidden until switched to.
    switchView('settings');
    const input = document.getElementById('setAdresse');
    input.focus();
    input.value = 'Noch nicht abgeschickter Entwurf';
    window.__store.practices[0].adresse = 'Von Kollege geändert';
    await window.__realtimeHandlers['practice-settings-changes']();
    return { value: document.getElementById('setAdresse').value };
  });
  expect(result.value, 'must not overwrite an in-progress edit while the field is focused').toBe('Noch nicht abgeschickter Entwurf');
});

test('secretary.html: a chat_enabled change from another tab live-updates the chat gating without a reload', async ({ page }) => {
  await installMockSupabase(page, seed(), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1000);

  const result = await page.evaluate(async () => {
    await practiceSettingsReady;
    window.__store.practices[0].chat_enabled = false;
    await window.__realtimeHandlers['practice-settings-changes']();
    return {
      noticeVisible: document.getElementById('secChatDisabledNotice')?.style.display,
      inputAreaVisible: document.getElementById('secChatInputArea')?.style.display,
    };
  });
  expect(result.noticeVisible).toBe('flex');
  expect(result.inputAreaVisible).toBe('none');
});
