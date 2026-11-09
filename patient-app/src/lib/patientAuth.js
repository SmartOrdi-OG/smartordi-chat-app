import { sb } from './supabase';

// Mirrors vendor/patient-portal-data.js's patientLogin() -- the real,
// Supabase-backed path only (username -> patient_login_precheck RPC
// resolves the auth email, then a normal password sign-in). The legacy
// local/demo-account fallback and guardian multi-profile switching from
// the original patient-login.html are intentionally not ported yet --
// this is a first proof-of-concept slice, not a full replacement.
export async function patientLogin(username, password) {
  const { data: email, error } = await sb.rpc('patient_login_precheck', {
    p_username: username,
    p_password: password,
  });
  if (error) {
    throw error;
  }
  if (!email) return null; // wrong credentials, or not an approved account yet

  const { error: signInErr } = await sb.auth.signInWithPassword({ email, password });
  if (signInErr) {
    console.error('patientLogin signIn failed', signInErr);
    return null;
  }
  const profile = await patientGetProfile();
  if (!profile) {
    await sb.auth.signOut();
    return null;
  }
  return profile;
}

// Mirrors vendor/patient-portal-data.js's patientGetProfile().
export async function patientGetProfile() {
  const { data, error } = await sb.rpc('patient_get_profile');
  if (error) {
    console.error('patientGetProfile failed', error);
    return null;
  }
  const row = data && data[0];
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    fullName: row.full_name,
    fach: row.fach,
    dob: row.dob,
    adresse: row.adresse,
    tel: row.tel,
    email: row.email,
    versicherung: row.versicherung,
    svnr: row.svnr,
    firstLogin: row.first_login,
    joinStatus: row.join_status,
    joinNote: row.join_note,
    anamnese: row.anamnese,
    isChild: !!row.is_child,
    geschlecht: row.geschlecht || null,
    consentGiven: !!row.consent_given_at,
    consentGivenAt: row.consent_given_at || null,
  };
}

export async function patientLogout() {
  await sb.auth.signOut();
}
