// Real Supabase Auth access for patient.html/patient-login.html --
// supabase/phase31_patient_auth.sql, phase32_auth_password_hash_helper.sql,
// phase33_patient_login_cutover.sql. Patients/guardians are now real
// Supabase Auth users (a synthetic, never-shown email under the hood --
// see phase31's header comment) instead of the old opaque
// patient_sessions/guardian_sessions token: every RPC below is called
// under the signed-in patient/guardian's own real session (supabase-js
// attaches it automatically), and resolves identity server-side via
// current_patient_id()/current_guardian_id() (auth.uid()-based) instead of
// a p_token argument.
//
// This is a separate file from vendor/patient-data.js (used by doctor.html/
// secretary.html) on purpose: that file's staff-mode caches call
// sb.from('termine').select('*') etc. directly, which patients/guardians
// still have no RLS access to -- every call here goes through a
// SECURITY DEFINER RPC instead, same as before, just resolved differently.

// PATIENT_TOKEN_KEY is no longer a real credential -- the actual session is
// the Supabase Auth JWT supabase-js itself manages (auto-refreshed, its own
// storage). This is kept purely as the same synchronous "is this a real,
// backend-linked account" truthy marker patient.html already checks in
// ~15 places (if(getPatientToken())...) -- rewriting every one of those to
// an async sb.auth.getSession() check would be a much larger, riskier
// change for zero actual benefit, since nothing sends this value to an RPC
// anymore. Set to any truthy string on real login, cleared on logout.
const PATIENT_TOKEN_KEY='smartordi_patient_token';
function getPatientToken(){
  return sessionStorage.getItem(PATIENT_TOKEN_KEY);
}
function setPatientToken(token){
  if(token) sessionStorage.setItem(PATIENT_TOKEN_KEY,token);
  else sessionStorage.removeItem(PATIENT_TOKEN_KEY);
}

// A patient only ever knows their own USERNAME, never the synthetic email
// Supabase Auth actually needs -- these two *_precheck RPCs are the lookup
// step (username+password -> email) that has to run before sign-in can
// even be attempted. They also preserve the account-lockout/temp-password-
// expiry logic (phase14_patient_login_hardening.sql) that real Supabase
// Auth doesn't replicate on its own -- see phase33's header comment for why
// that couldn't just be dropped in favor of GoTrue's own (different,
// generic) rate-limiting.
//
// Returns the same shape the old patient_login RPC did (fullName, name,
// firstLogin, joinStatus, joinNote, anamnese) so callers don't need to
// change, now sourced from patient_get_profile() after a real sign-in
// instead of all coming back from one token-minting call.
async function patientLogin(username,password){
  const {data:email,error}=await sb.rpc('patient_login_precheck',{p_username:username,p_password:password});
  if(error){
    // phase14_patient_login_hardening.sql -- these two are real, actionable
    // states the login screen shows a specific message for, so they're
    // re-thrown instead of silently swallowed. Anything else keeps the
    // original behavior (caller falls back to check_join_request_status).
    if(error.message&&(error.message.indexOf('account_locked')!==-1||error.message.indexOf('temp_password_expired')!==-1)){
      throw error;
    }
    console.error('patientLogin precheck failed',error); return null;
  }
  if(!email) return null; // wrong username/password, or not an approved account yet
  const {error:signInErr}=await sb.auth.signInWithPassword({email,password});
  if(signInErr){ console.error('patientLogin signIn failed',signInErr); return null; }
  const profile=await patientGetProfile();
  if(!profile){ await sb.auth.signOut(); return null; }
  return {
    fullName: profile.fullName, name: profile.name, firstLogin: profile.firstLogin,
    joinStatus: profile.joinStatus, joinNote: profile.joinNote, anamnese: profile.anamnese,
    isChild: profile.isChild,
  };
}
// ── GUARDIAN LOGIN (supabase/phase28_guardian_child_accounts.sql) -- a
// parent logging in on behalf of a child patient too young for their own
// login. A guardian is a real Supabase Auth user in its own right (not
// itself a patient); guardianSelectChild() records which child this
// guardian's session is "acting as" (guardian_active_child, phase31) --
// every patient_* function below then resolves to that child automatically
// via current_patient_id(), for as long as this guardian stays signed in. ──
async function guardianLogin(username,password){
  const {data:email,error}=await sb.rpc('guardian_login_precheck',{p_username:username,p_password:password});
  if(error){ console.error('guardianLogin precheck failed',error); return null; }
  if(!email) return null;
  const {error:signInErr}=await sb.auth.signInWithPassword({email,password});
  if(signInErr){ console.error('guardianLogin signIn failed',signInErr); return null; }
  const {data:row,error:profileErr}=await sb.rpc('guardian_get_profile');
  const profile=row&&row[0];
  if(profileErr||!profile){ console.error('guardianLogin profile fetch failed',profileErr); await sb.auth.signOut(); return null; }
  return { fullName:profile.full_name, name:profile.name, firstLogin:profile.first_login };
}
async function guardianChangePassword(newPassword){
  const {error}=await sb.auth.updateUser({password:newPassword});
  if(error){ console.error('guardianChangePassword failed',error); return false; }
  const {data:ok,error:markErr}=await sb.rpc('guardian_mark_password_changed');
  if(markErr){ console.error('guardian_mark_password_changed failed',markErr); return false; }
  return !!ok;
}
async function guardianGetChildren(){
  const {data,error}=await sb.rpc('guardian_get_children');
  if(error){ console.error('guardianGetChildren failed',error); return []; }
  return (data||[]).map(row=>({ id:row.id, username:row.username, name:row.name, fullName:row.full_name, fach:row.fach, dob:row.dob }));
}
async function guardianSelectChild(childId){
  const {data,error}=await sb.rpc('guardian_select_child',{p_child_id:childId});
  if(error){ console.error('guardianSelectChild failed',error); return false; }
  return !!data;
}
async function patientChangePassword(newPassword){
  const {error}=await sb.auth.updateUser({password:newPassword});
  if(error){ console.error('patientChangePassword failed',error); return false; }
  const {data:ok,error:markErr}=await sb.rpc('patient_mark_password_changed');
  if(markErr){ console.error('patient_mark_password_changed failed',markErr); return false; }
  return !!ok;
}
// supabase/phase65_patient_username_change_and_is_child.sql -- lets a
// patient replace the system-generated username secretary.html's QR flow
// assigned them (e.g. "max.mustermann", easy to forget since they never
// typed it themselves) with one of their own choosing, from the same
// first-login screen where they already set their password. Returns
// {ok:true} on success, or {ok:false, code} where code is
// 'too_short'/'taken'/'error' so the caller can show the specific reason
// instead of one generic failure message.
async function patientChangeUsername(newUsername){
  const {data:ok,error}=await sb.rpc('patient_change_username',{p_new_username:newUsername});
  if(error){
    const msg=String(error.message||'');
    if(msg.indexOf('username_too_short')!==-1) return {ok:false,code:'too_short'};
    if(msg.indexOf('username_taken')!==-1) return {ok:false,code:'taken'};
    console.error('patientChangeUsername failed',error);
    return {ok:false,code:'error'};
  }
  return {ok:!!ok};
}
// supabase/phase20_patient_self_deletion.sql -- lets the patient request
// their own erasure (Art. 17 DSGVO) directly, instead of only through
// staff. Same retention-reconciliation logic as the staff-facing
// request_patient_deletion() (10-year § 51 ÄrzteG retention): anonymizes
// immediately if that period already elapsed, otherwise schedules the
// legally earliest allowed date and returns it.
async function patientRequestDeletion(){
  const {data,error}=await sb.rpc('patient_request_deletion');
  if(error){ console.error('patientRequestDeletion failed',error); throw error; }
  return data&&data[0];
}
// supabase/phase8_anamnese.sql -- saves the mandatory first-login Anamnese
// questionnaire server-side instead of a browser-local record, so it's
// visible from any device the patient logs in from afterward.
async function patientSetAnamnese(data){
  const {data:ok,error}=await sb.rpc('patient_set_anamnese',{p_data:data});
  if(error){ console.error('patientSetAnamnese failed',error); return false; }
  return !!ok;
}
// supabase/phase29_practice_working_hours.sql -- the practice's own
// configured Öffnungszeiten (patients have no direct table access to
// `practices`, same reasoning as every other function here). Returns null
// on any failure, the caller (patient.html) falls back to the same
// DEFAULT_WORKING_HOURS a staff session uses when nothing's configured yet.
async function patientGetWorkingHours(){
  const {data,error}=await sb.rpc('patient_get_working_hours');
  if(error){ console.error('patientGetWorkingHours failed',error); return null; }
  return data||null;
}
// supabase/phase34_chat_toggle.sql -- practice-wide "Chat aktivieren"
// switch (doctor.html Einstellungen). Defaults to true on any failure --
// same fail-open reasoning as every other best-effort read here: a
// transient error must never be the reason a patient's chat access
// disappears.
async function patientGetChatEnabled(){
  const {data,error}=await sb.rpc('patient_get_chat_enabled');
  if(error){ console.error('patientGetChatEnabled failed',error); return true; }
  return data!==false;
}
// supabase/phase44_online_booking_toggle.sql -- practice-wide "Online-
// Terminbuchung" switch (secretary.html Terminverwaltung). Same fail-open
// reasoning as patientGetChatEnabled() above: a transient read error must
// never be the reason booking disappears for a patient.
async function patientGetBookingEnabled(){
  const {data,error}=await sb.rpc('patient_get_booking_enabled');
  if(error){ console.error('patientGetBookingEnabled failed',error); return true; }
  return data!==false;
}
// supabase/phase45_patient_staff_roster.sql -- vendor/staff-accounts.js's
// refreshStaffRoster() does a direct sb.from('staff_profiles').select('*'),
// which relies on RLS scoping to a STAFF session (current_practice_id()
// reads FROM staff_profiles, so it resolves to null for a real patient/
// guardian, whose own auth.uid() has no row there at all) -- that left the
// "Termin buchen" Arzt dropdown, and the Profil tab's "Behandelnde Ärzte"
// row, silently empty for every real patient/guardian session (found via
// a user report). Overwrites the SAME _staffRoster module variable
// staff-accounts.js declares (this file loads after it, in the same page)
// via a real SECURITY DEFINER RPC instead, so loadStaffAccounts()/
// arztAccounts()/arztDisplayName() all keep working unchanged.
async function patientRefreshStaffRoster(){
  const {data,error}=await sb.rpc('patient_get_staff_roster');
  if(error){ console.error('patientRefreshStaffRoster failed',error); return; }
  const next={};
  (data||[]).forEach(p=>{
    // isAdmin -- supabase/phase55_patient_staff_roster_is_admin.sql. Without
    // it, updatePracticeIdentityUI()'s accounts.find(a=>a.role==='arzt' &&
    // a.isAdmin) never matched anyone for a real patient/guardian session,
    // leaving the chat header/Termine subtitle stuck on "—" even though the
    // roster itself had resolved correctly (found via a user report).
    next[p.id]={ vorname:p.vorname, nachname:p.nachname, fullName:p.full_name, role:p.role, fach:p.fach, isAdmin:p.is_admin };
  });
  _staffRoster=next;
}
// Ends the real Supabase Auth session (server-side revocation of the
// refresh token, not just a local clear) -- supabase-js's own signOut(),
// replacing the old patient_logout RPC entirely.
async function patientLogout(){
  const {error}=await sb.auth.signOut();
  if(error) console.error('patientLogout failed',error);
}
// reportCriticalDataError() (not just console.error, unlike this file's
// other patientGetX() calls) -- a failed profile fetch is the one failure
// in this file that leaves the ENTIRE Profil view frozen on its static
// "--" placeholders with zero visible indication anything went wrong,
// indistinguishable from a genuinely broken/empty account to the patient
// looking at their own screen. Real report, with a screenshot. Same
// reasoning as vendor/patient-data.js's refreshPatients() etc.
async function patientGetProfile(){
  const {data,error}=await sb.rpc('patient_get_profile');
  if(error){ reportCriticalDataError('patientGetProfile',error); return null; }
  const row=data&&data[0];
  if(!row) return null;
  return {
    id: row.id, username: row.username, name: row.name, fullName: row.full_name,
    fach: row.fach, dob: row.dob, adresse: row.adresse, tel: row.tel, email: row.email,
    versicherung: row.versicherung, svnr: row.svnr, firstLogin: row.first_login,
    joinStatus: row.join_status, joinNote: row.join_note, anamnese: row.anamnese,
    isChild: !!row.is_child,
  };
}
async function patientGetMessages(){
  const {data,error}=await sb.rpc('patient_get_messages');
  if(error){ console.error('patientGetMessages failed',error); return []; }
  return (data||[]).map(function(row){
    // createdAt (full ISO timestamp, kept alongside the display-only "time"
    // HH:MM) -- patient.html's unread-badge tracking needs this to compare
    // against a per-device "last viewed" marker (patientUnreadCount()).
    return {dir:row.dir, type:row.type, text:row.text, time:(row.created_at||'').slice(11,16),
      createdAt:row.created_at, docId:row.doc_id, filename:row.filename, sub:row.doc_sub};
  });
}
async function patientSendMessage(text){
  const {data,error}=await sb.rpc('patient_send_message',{p_text:text});
  if(error){ console.error('patientSendMessage failed',error); throw error; }
  return data;
}
function terminRowToJsPatient(row){
  return {
    id: row.id, patient: row.patient_name, art: row.art, date: row.date, time: row.time,
    endTime: row.end_time, status: row.status, arztUsername: row.arzt_id,
    reason: row.reason, reasonNote: row.reason_note,
  };
}
async function patientGetTermine(){
  const {data,error}=await sb.rpc('patient_get_termine');
  if(error){ console.error('patientGetTermine failed',error); return []; }
  return (data||[]).map(terminRowToJsPatient);
}
async function patientBookTermin(fields){
  const {data,error}=await sb.rpc('patient_book_termin',{
    p_arzt_id:fields.arztUsername, p_date:fields.date,
    p_time:fields.time, p_end_time:fields.endTime, p_art:fields.art,
  });
  if(error){ console.error('patientBookTermin failed',error); throw error; }
  return terminRowToJsPatient(data);
}
async function patientSetSymptoms(terminId,reason,reasonNote){
  const {data,error}=await sb.rpc('patient_set_symptoms',{p_termin_id:terminId,p_reason:reason,p_reason_note:reasonNote});
  if(error){ console.error('patientSetSymptoms failed',error); return false; }
  return !!data;
}
// supabase/phase63_patient_update_profile.sql -- lets a patient edit their
// own contact details (address/phone/email) from patient.html's Settings
// area. Deliberately narrow: name/Geburtsdatum/Versicherung/SV-Nummer have
// no patient-facing edit path at all (identity/legal/insurance fields stay
// staff-controlled), same as the RPC itself only ever accepting these 3.
async function patientUpdateProfile(fields){
  const {data,error}=await sb.rpc('patient_update_profile',{
    p_adresse:fields.adresse, p_tel:fields.tel, p_email:fields.email,
  });
  if(error){ console.error('patientUpdateProfile failed',error); return false; }
  return !!data;
}
// supabase/phase64_unified_account_profiles.sql -- one login can hold
// several independent patient profiles (own + any linked child/adult).
// patientGetProfiles() lists every profile this login can switch to;
// patientSwitchProfile() changes which one current_patient_id() resolves to
// for every subsequent patient_*/RPC call, for the rest of this session.
async function patientGetProfiles(){
  const {data,error}=await sb.rpc('patient_get_profiles');
  if(error){ console.error('patientGetProfiles failed',error); return []; }
  return (data||[]).map(function(r){
    return {
      patientId:r.patient_id, fullName:r.full_name, relation:r.relation,
      relationLabel:r.relation_label, practiceId:r.practice_id,
      practiceName:r.practice_name, isActive:r.is_active,
    };
  });
}
async function patientSwitchProfile(patientId){
  const {data,error}=await sb.rpc('patient_switch_profile',{p_patient_id:patientId});
  if(error){ console.error('patientSwitchProfile failed',error); return false; }
  return !!data;
}
// supabase/phase66_retire_guardian_login_system.sql -- current_patient_id()
// can resolve to nothing even though this login DOES have at least one
// real profile available: a guardian who just authenticated and hasn't
// had a child selected yet this session (patient_active_profile/
// guardian_active_child both empty for this auth_user_id), or any
// multi-profile account rehydrating in a fresh tab with no active-profile
// row set. Auto-switches to the first profile patient_get_profiles()
// returns (its own existing ordering: a "self" row first if this login
// has one, then alphabetical) instead of leaving the account looking
// sessionless. Shared by patient-login.html's guardian-login routing and
// patient.html's rehydrateSessionFromRealAuth(). Returns the profile
// switched to, or null if this account genuinely has zero profiles at all
// yet (e.g. an unmigrated guardian) -- callers decide their own fallback.
async function ensureActiveProfile(){
  const profiles=await patientGetProfiles();
  if(!profiles.length) return null;
  const active=profiles.find(p=>p.isActive);
  if(active) return active;
  const ok=await patientSwitchProfile(profiles[0].patientId);
  return ok?profiles[0]:null;
}
// Submits a request to add a new profile (a child, or another adult like a
// father/mother) onto THIS login -- still goes through the exact same staff
// review as any new patient (patient_join_requests/secretary.html's
// Beitrittsanfragen), just carrying which existing account it should attach
// to once approved.
async function patientSubmitProfileJoinRequest(practiceId,vorname,nachname,adresse,svnr,relation,relationLabel){
  const {data,error}=await sb.rpc('patient_submit_profile_join_request',{
    p_practice_id:practiceId, p_vorname:vorname, p_nachname:nachname,
    p_adresse:adresse, p_svnr:svnr, p_relation:relation, p_relation_label:relationLabel||null,
  });
  if(error){ console.error('patientSubmitProfileJoinRequest failed',error); throw error; }
  return data;
}
// supabase/phase2_patient_documents.sql -- documents a staff member uploaded
// for this patient (lab results, referrals...). patientGetDocuments() only
// returns metadata; the base64 file body is fetched separately per document
// via patientGetDocumentFile() so opening the list doesn't pull every file
// over the wire.
async function patientGetDocuments(){
  const {data,error}=await sb.rpc('patient_get_documents');
  if(error){ console.error('patientGetDocuments failed',error); return []; }
  return (data||[]).map(function(row){
    return {id:row.id, category:row.category, title:row.title, filename:row.filename,
      mimeType:row.mime_type, sizeBytes:row.size_bytes, bodyText:row.body_text, createdAt:row.created_at};
  });
}
async function patientGetDocumentFile(docId){
  const {data,error}=await sb.rpc('patient_get_document_file',{p_doc_id:docId});
  if(error){ console.error('patientGetDocumentFile failed',error); return null; }
  const row=data&&data[0];
  if(!row) return null;
  return {filename:row.filename, mimeType:row.mime_type, base64:row.file_data};
}
// supabase/phase5_impfungen.sql -- unlike patient_documents, this one exists
// specifically so a parent can see their child's own vaccination status
// (daycare/school proof), not just staff.
async function patientGetImpfungen(){
  const {data,error}=await sb.rpc('patient_get_impfungen');
  if(error){ console.error('patientGetImpfungen failed',error); return []; }
  return (data||[]).map(function(row){
    return {id:row.id, vaccineKey:row.vaccine_key, vaccineName:row.vaccine_name,
      doseLabel:row.dose_label, datum:row.datum, nextDue:row.next_due, createdAt:row.created_at};
  });
}
// supabase/phase69_patient_mkp_readonly.sql -- read-only, own-child-only
// view of the pediatrician's Mutter-Kind-Pass exam records (mkp_
// untersuchungen is otherwise a staff-only table, see phase4's own header).
async function patientGetMkpExams(){
  const {data,error}=await sb.rpc('patient_get_mkp_exams');
  if(error){ console.error('patientGetMkpExams failed',error); return []; }
  return (data||[]).map(function(row){
    return {examKey:row.exam_key, data:row.data||{}, completedAt:row.completed_at};
  });
}
