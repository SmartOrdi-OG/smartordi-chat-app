import { sb } from './supabase';

const POLICY_VERSION = '2.1';

// phase89_practice_short_code.sql -- resolves a short, typeable practice
// code (practices.short_code, e.g. "2TW3BZ") from a /patient-register/<code>
// link into the real practice id. Case-insensitive on the server side.
export async function resolvePracticeShortCode(code) {
  const { data, error } = await sb.rpc('public_resolve_practice_short_code', { p_code: code });
  if (error) {
    console.error('resolvePracticeShortCode failed', error);
    return null;
  }
  return data || null;
}

// Mirrors patient-login.html's public_get_practice_join_info() call --
// shows the practice name on the registration form so the patient can
// confirm they're applying to the right Ordination.
export async function getPracticeJoinInfo(practiceId) {
  const { data, error } = await sb.rpc('public_get_practice_join_info', { p_practice_id: practiceId });
  if (error) {
    console.error('getPracticeJoinInfo failed', error);
    return null;
  }
  const row = data && data[0];
  if (!row) return null;
  return {
    practiceName: row.practice_name,
    adresse: row.adresse,
    adminFullName: row.admin_full_name,
    adminFach: row.admin_fach,
  };
}

// Mirrors patient-login.html's performJoinRequestSubmit() -- a direct
// insert into patient_join_requests (anon role has INSERT-only RLS on
// this table, never SELECT/UPDATE), plus a fire-and-forget consent
// record. Not yet ported: the in-app QR-scan "no practice known yet"
// path, and the guardian "add another profile" variant
// (patient_submit_profile_join_request) -- both not needed for this
// first slice, which assumes a practice id arrives via ?practice=<id>.
export async function submitJoinRequest(fields, practiceId, isChild) {
  const fullName = `${fields.vorname} ${fields.nachname}`;
  const { error } = await sb.from('patient_join_requests').insert({
    username: fields.username, vorname: fields.vorname, nachname: fields.nachname,
    full_name: fullName, dob: fields.dob, tel: fields.tel, adresse: fields.adresse,
    svnr: fields.svnr, temp_password: fields.pw, practice_id: practiceId,
    is_child: !!isChild, geschlecht: fields.geschlecht || null,
    versicherung: fields.versicherung || null,
  });
  if (error) {
    console.error('submitJoinRequest failed', error);
    throw error;
  }

  sb.rpc('record_consent', {
    p_practice_id: practiceId, p_consent_type: 'patient_join_request',
    p_full_name: fullName, p_email: null, p_policy_version: POLICY_VERSION,
    p_user_agent: navigator.userAgent,
  }).then(({ error: consentErr }) => { if (consentErr) console.error('record_consent failed', consentErr); });
}
