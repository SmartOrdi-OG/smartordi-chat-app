import { sb } from './supabase';
import { insertNewPatientIdentity, ensurePatientAuthUser, isPatientLimitReached, getPlanLabelAndLimit } from './patientsData';

// Mirrors secretary.html's "Beitrittsanfragen" (patient_join_requests) --
// a patient who self-registered via patient-app's "Anmeldung beantragen"
// screen, without ever visiting the Ordination (submitJoinRequest(),
// patient-app/src/lib/patientRegister.js) or, with linked_auth_user_id set,
// an already-logged-in patient adding a family profile
// (patientSubmitProfileJoinRequest()). Neither ever creates a real
// `patients` row by itself -- that only happens here, once staff approves.

export async function fetchPendingJoinRequests() {
  const { data, error } = await sb.from('patient_join_requests').select('*').eq('status', 'pending').order('submitted_at', { ascending: true });
  if (error) {
    console.error('fetchPendingJoinRequests failed', error);
    return [];
  }
  return data || [];
}

export function relationLabelDe(relation, relationLabel) {
  if (relation === 'child') return 'Kind';
  if (relation === 'father') return 'Vater';
  if (relation === 'mother') return 'Mutter';
  return relationLabel || 'Erwachsene/r';
}

// Returns {ok:true} or {ok:false, error:string}. `fach` is the practice
// admin's own fach (same as a brand-new "+ Neuer Patient" account) -- a
// self-registered patient never specifies a Fachrichtung themselves.
export async function approveJoinRequest(username, fach) {
  if (await isPatientLimitReached()) {
    const { label, limit } = await getPlanLabelAndLimit();
    return { ok: false, error: 'Patientenlimit des ' + label + '-Pakets erreicht (' + limit + ' Patienten). Bitte auf Enterprise upgraden.' };
  }
  const { data: req, error: fetchErr } = await sb.from('patient_join_requests').select('*').eq('username', username).eq('status', 'pending').order('submitted_at', { ascending: false }).limit(1).maybeSingle();
  if (fetchErr || !req) return { ok: false, error: 'Anfrage konnte nicht geladen werden' };

  const { error: updateErr } = await sb.from('patient_join_requests').update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('username', username).eq('status', 'pending');
  if (updateErr) return { ok: false, error: 'Fehler: ' + updateErr.message };

  // first_login:false -- a self-registered patient already chose their own
  // permanent username/password on patient-app's own registration form,
  // unlike "+ Neuer Patient"'s throwaway system-generated temp credential,
  // which genuinely needs changing on first login.
  const result = await insertNewPatientIdentity(username, {
    name: req.vorname, full_name: req.full_name, fach,
    dob: req.dob || null, tel: req.tel || null, adresse: req.adresse || null,
    svnr: req.svnr || null, versicherung: req.versicherung || null,
    is_child: !!req.is_child, geschlecht: req.geschlecht || null,
    join_status: 'approved', first_login: false, pw_hash: req.pw_hash || null,
  });
  if (result.collision) return { ok: false, error: 'Anlegen fehlgeschlagen: Benutzername bereits vergeben.' };
  const row = result.row;

  // This device never saw this patient's real plaintext password (chosen on
  // their own device at self-registration) -- only the already-hashed
  // pw_hash a database trigger computed from their submitted temp_password,
  // so this provisions their real Auth user by copying that hash across
  // instead of setting a brand-new password.
  if (req.pw_hash) ensurePatientAuthUser('patient', row.id, { existingHash: req.pw_hash });

  // A request submitted from an existing patient's own "add a profile" flow
  // (linked_auth_user_id set) needs this one extra step: linking the new
  // patients row into that account's own patient_account_profiles.
  if (req.linked_auth_user_id) {
    const { data: linked, error: linkErr } = await sb.rpc('staff_link_account_profile', { p_join_request_id: req.id });
    if (linkErr || !linked) console.error('staff_link_account_profile failed for request', req.id, linkErr);
  }

  return { ok: true, fullName: req.full_name };
}

export async function rejectJoinRequest(username, note) {
  const { data: req, error } = await sb.from('patient_join_requests').update({ status: 'rejected', note: (note || '').trim(), reviewed_at: new Date().toISOString() }).eq('username', username).eq('status', 'pending').select().maybeSingle();
  if (error || !req) return { ok: false };
  return { ok: true, fullName: req.full_name };
}
