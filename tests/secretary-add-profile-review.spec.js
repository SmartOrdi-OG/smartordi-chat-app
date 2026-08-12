// Phase B of the unified-account-profiles feature (supabase/phase64_
// unified_account_profiles.sql was schema/RPC-only, Phase A):
// 1. secretary.html's "+ Neuer Patient" no longer has a separate "Kind"
//    checkbox/guardian-creation path -- every patient (child or adult) gets
//    an ordinary account now, per the confirmed design (a parent adds
//    themselves onto a child's account afterward, from patient.html, not
//    the other way around).
// 2. Beitrittsanfragen now flags a request submitted from an existing
//    patient's own "Kind/Erwachsene:n hinzufügen" (patient.html) -- and
//    approving it performs the extra linking step (staff_link_account_
//    profile()) a brand-new self-registration never needs.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extraRequests) {
  return {
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
    practice_settings: [{ id: true }],
    patient_join_requests: extraRequests || [],
  };
}

async function setupPage(page, extraRequests) {
  await installMockSupabase(page, seed(extraRequests), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'sekretaerin', name: 'Test Sek', username: 'sek1', isAdmin: false }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
    localStorage.setItem('smartordi_staff_accounts', JSON.stringify({ 'dr.ahmed': { username: 'dr.ahmed', fullName: 'Dr. Sarah Ahmed', role: 'arzt', isAdmin: true, fach: 'Allgemeinmedizin' } }));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'secretary.html'));
  await page.waitForTimeout(1200);
}

// Real user feedback (2026-08-11): removing the "Kind" checkbox entirely
// (see the module comment above) also removed staff's only way to note in
// a patient's own record that they're a child -- deliberately reintroduced
// via supabase/phase65_patient_username_change_and_is_child.sql, but as a
// plain classification flag only. The OLD guardian-creation mini-form
// (npGuardianFields/npGuardianVorname, superseded by this feature's unified-
// profile model) must still not be back.
test('"+ Neuer Patient" has a plain "Kind" checkbox, but no guardian-creation fields', async ({ page }) => {
  await setupPage(page);
  const state = await page.evaluate(() => {
    openNewPatientModal();
    return {
      hasIsChild: !!document.getElementById('npIsChild'),
      hasGuardianFields: !!document.getElementById('npGuardianFields'),
      hasGuardianVorname: !!document.getElementById('npGuardianVorname'),
    };
  });
  expect(state.hasIsChild).toBe(true);
  expect(state.hasGuardianFields).toBe(false);
  expect(state.hasGuardianVorname).toBe(false);
});

test('confirmNewPatient() always creates an ordinary patient account, regardless of the patient\'s age', async ({ page }) => {
  await setupPage(page);
  const result = await page.evaluate(async () => {
    openNewPatientModal();
    document.getElementById('npVorname').value = 'Tom';
    document.getElementById('npNachname').value = 'Huber';
    document.getElementById('npGeburtsdatum').value = '2018-01-01';
    document.getElementById('npAdresse').value = 'Teststr. 1, 1010 Wien';
    document.getElementById('npTelefon').value = '+43 1 2345678';
    await confirmNewPatient();
    return {
      patients: window.__store.patients,
      guardians: window.__store.patient_guardians || [],
      credModalOpen: document.getElementById('patientCredentialsModal').classList.contains('show'),
      credUsername: document.getElementById('credUsername').textContent,
    };
  });
  expect(result.guardians, 'no separate guardian row should ever be created from this flow anymore').toHaveLength(0);
  expect(result.patients.some(p => p.full_name === 'Tom Huber')).toBe(true);
  expect(result.credModalOpen).toBe(true);
  expect(result.credUsername).toBeTruthy();
});

test('renderJoinRequests() flags a request linked to an existing account, but not an ordinary self-registration', async ({ page }) => {
  await setupPage(page, [
    { id: 'jr1', username: 'neuer.patient', vorname: 'Neuer', nachname: 'Patient', full_name: 'Neuer Patient', adresse: 'Musterstr 1', svnr: '1111111111', pw_hash: 'h1', status: 'pending', submitted_at: '2026-08-01T10:00:00Z' },
    { id: 'jr2', username: 'profil-xyz', vorname: 'Tom', nachname: 'Huber', full_name: 'Tom Huber', adresse: null, svnr: null, pw_hash: 'h2', status: 'pending', submitted_at: '2026-08-02T10:00:00Z', linked_auth_user_id: 'auth-maria', relation: 'child', relation_label: null },
  ]);
  await page.evaluate(async () => { await renderJoinRequests(); });
  const html = await page.evaluate(() => document.getElementById('joinRequestsList').innerHTML);
  expect(html).toContain('Neuer Patient');
  expect(html).toContain('Tom Huber');
  // Only the linked request gets the 🔗 badge with its relation.
  expect(html.indexOf('🔗')).toBeGreaterThan(-1);
  expect((html.match(/🔗/g) || []).length).toBe(1);
  expect(html).toContain('Kind');
  expect(html).toContain('bestehenden Zugang');
});

test('approving a linked ("Kind/Erwachsene:n hinzufügen") request also calls staff_link_account_profile once the patients row exists', async ({ page }) => {
  await setupPage(page, [
    { id: 'jr2', username: 'profil-xyz', vorname: 'Tom', nachname: 'Huber', full_name: 'Tom Huber', adresse: null, svnr: null, pw_hash: 'h2', status: 'pending', submitted_at: '2026-08-02T10:00:00Z', linked_auth_user_id: 'auth-maria', relation: 'child', relation_label: null },
  ]);
  const result = await page.evaluate(async () => {
    let linkCalledWith = null;
    sb.rpc = (name, args) => {
      if (name === 'staff_link_account_profile') { linkCalledWith = args; return Promise.resolve({ data: true, error: null }); }
      return Promise.resolve({ data: [], error: null });
    };
    await approveJoinRequest('profil-xyz');
    await new Promise(r => setTimeout(r, 200));
    return { linkCalledWith, request: window.__store.patient_join_requests.find(r => r.username === 'profil-xyz') };
  });
  expect(result.request.status).toBe('approved');
  expect(result.linkCalledWith, 'staff_link_account_profile() must be called once the linked request is approved').toBeTruthy();
  expect(result.linkCalledWith.p_join_request_id).toBe('jr2');
});

test('approving an ordinary (non-linked) self-registration never calls staff_link_account_profile', async ({ page }) => {
  await setupPage(page, [
    { id: 'jr1', username: 'neuer.patient', vorname: 'Neuer', nachname: 'Patient', full_name: 'Neuer Patient', adresse: 'Musterstr 1', svnr: '1111111111', pw_hash: 'h1', status: 'pending', submitted_at: '2026-08-01T10:00:00Z' },
  ]);
  const result = await page.evaluate(async () => {
    let linkCalled = false;
    sb.rpc = (name) => {
      if (name === 'staff_link_account_profile') { linkCalled = true; }
      return Promise.resolve({ data: [], error: null });
    };
    await approveJoinRequest('neuer.patient');
    await new Promise(r => setTimeout(r, 200));
    return { linkCalled };
  });
  expect(result.linkCalled).toBe(false);
});

// Item 5b (real user feedback, 2026-08-11): patient-login.html's
// self-registration screen now has a "Für mich / Für mein Kind" choice
// (supabase/phase65_patient_username_change_and_is_child.sql's is_child
// column on patient_join_requests) -- approving the request must carry
// that flag through onto the resulting patients row.
test('approving a self-registration submitted as "Für mein Kind" copies is_child onto the new patients row', async ({ page }) => {
  await setupPage(page, [
    { id: 'jr3', username: 'kind.patient', vorname: 'Lena', nachname: 'Patient', full_name: 'Lena Patient', adresse: 'Musterstr 2', svnr: '2222222222', pw_hash: 'h3', status: 'pending', submitted_at: '2026-08-03T10:00:00Z', is_child: true },
  ]);
  const result = await page.evaluate(async () => {
    await approveJoinRequest('kind.patient');
    await new Promise(r => setTimeout(r, 200));
    return window.__store.patients.find(p => p.username === 'kind.patient');
  });
  expect(result).toBeTruthy();
  expect(result.is_child).toBe(true);
});

test('approving an ordinary self-registration ("Für mich") stores is_child as false', async ({ page }) => {
  await setupPage(page, [
    { id: 'jr4', username: 'erwachsen.patient', vorname: 'Peter', nachname: 'Patient', full_name: 'Peter Patient', adresse: 'Musterstr 3', svnr: '3333333333', pw_hash: 'h4', status: 'pending', submitted_at: '2026-08-04T10:00:00Z', is_child: false },
  ]);
  const result = await page.evaluate(async () => {
    await approveJoinRequest('erwachsen.patient');
    await new Promise(r => setTimeout(r, 200));
    return window.__store.patients.find(p => p.username === 'erwachsen.patient');
  });
  expect(result).toBeTruthy();
  expect(result.is_child).toBe(false);
});
