// Regression test for a critical, real production bug (2026-08-03): a
// doctor reported "Speichern fehlgeschlagen" saving an existing patient's
// Anamnese. The browser console showed a genuine Postgres error --
// {code: '23502', message: 'null value in column "name" of relation
// "patients" violates not-null constraint'} -- from
// upsertPatientIdentity()'s single .upsert(row, {onConflict:'username'})
// call.
//
// Root cause: a real INSERT ... ON CONFLICT(username) DO UPDATE validates
// NOT NULL constraints (patients.name/full_name have no default) against
// the attempted INSERT tuple BEFORE Postgres even checks whether a
// conflict exists -- so ANY partial-field-only call for an ALREADY-
// EXISTING patient (saveAnamnese() sending only {anamnese},
// resetPatientPassword() sending only {temp_password,first_login}, a bare
// SVNr correction, ...) failed this way, even though the row already had
// a real name and was never actually going to be inserted. This was
// invisible to the old mock, whose upsert() just did a lenient
// Object.assign(existing, partialFields) merge with no constraint
// checking at all -- these tests both prove the real fix (split into a
// genuine UPDATE-if-exists / INSERT-if-not, see upsertPatientIdentity()'s
// own comment) AND that the mock itself now models the same Postgres
// gotcha, so a future regression back to a bare .upsert() call would be
// caught here instead of only live in production.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installMockSupabase } = require('./helpers/mockSupabase');

function seed(extra) {
  return Object.assign({
    staff_profiles: [{ id: 'u1', vorname: 'Sarah', nachname: 'Ahmed', full_name: 'Dr. Sarah Ahmed', role: 'arzt', fach: 'Allgemeinmedizin', is_admin: true, email: 'a@a.at', username: 'dr.ahmed' }],
  }, extra);
}

async function setupPage(page, extraSeed) {
  await installMockSupabase(page, seed(extraSeed), () => {
    sessionStorage.setItem('smartordi_user', JSON.stringify({ role: 'arzt', name: 'Dr. Sarah Ahmed', username: 'dr.ahmed', isAdmin: true }));
    localStorage.setItem('smartordi_patient_accounts', JSON.stringify({}));
  });
  await page.goto('file://' + path.join(__dirname, '..', 'doctor.html'));
  await page.waitForTimeout(1200);
}

test('upsertPatientIdentity() saves a single field on an existing patient without needing name/full_name in the payload', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'ahmad.saadat', full_name: 'Ahmad Saadat', name: 'Ahmad', join_status: 'approved' }],
  });
  const result = await page.evaluate(async () => {
    await patientsReady;
    const data = await upsertPatientIdentity('ahmad.saadat', { anamnese: { beruf: 'Lehrer' } });
    return {
      returnedAnamnese: data.anamnese,
      returnedFullName: data.full_name,
      rowCount: window.__store.patients.length,
    };
  });
  expect(result.returnedAnamnese).toEqual({ beruf: 'Lehrer' });
  expect(result.returnedFullName, 'the existing name must survive untouched, not get wiped/nulled').toBe('Ahmad Saadat');
  expect(result.rowCount, 'must update the existing row, not insert a second one').toBe(1);
});

test('upsertPatientIdentity() still creates a genuinely new patient when given full identity fields', async ({ page }) => {
  await setupPage(page, { patients: [] });
  const result = await page.evaluate(async () => {
    await patientsReady;
    const data = await upsertPatientIdentity('neu.patient', { name: 'Neu', full_name: 'Neu Patient', join_status: 'approved' });
    return { fullName: data.full_name, rowCount: window.__store.patients.length };
  });
  expect(result.fullName).toBe('Neu Patient');
  expect(result.rowCount).toBe(1);
});

test('upsertGuardianIdentity() saves a single field on an existing guardian without needing name/full_name in the payload', async ({ page }) => {
  await setupPage(page, {
    patient_guardians: [{ id: 'g1', username: 'anna.bauer', full_name: 'Anna Bauer', name: 'Anna' }],
  });
  const result = await page.evaluate(async () => {
    await guardiansReady;
    const data = await upsertGuardianIdentity('anna.bauer', { first_login: false });
    return {
      returnedFirstLogin: data.first_login,
      returnedFullName: data.full_name,
      rowCount: window.__store.patient_guardians.length,
    };
  });
  expect(result.returnedFirstLogin).toBe(false);
  expect(result.returnedFullName, 'the existing name must survive untouched, not get wiped/nulled').toBe('Anna Bauer');
  expect(result.rowCount, 'must update the existing row, not insert a second one').toBe(1);
});

test('the mock itself now catches a bare partial-field .upsert() the way real Postgres would (proves this bug class is no longer invisible to CI)', async ({ page }) => {
  await setupPage(page, {
    patients: [{ id: 'p1', username: 'ahmad.saadat', full_name: 'Ahmad Saadat', name: 'Ahmad', join_status: 'approved' }],
  });
  const result = await page.evaluate(async () => {
    const { error } = await sb.from('patients').upsert({ username: 'ahmad.saadat', anamnese: { x: 1 } }, { onConflict: 'username' }).select().single();
    return { code: error && error.code, message: error && error.message };
  });
  expect(result.code).toBe('23502');
  expect(result.message).toContain('violates not-null constraint');
});
