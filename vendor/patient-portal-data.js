// RPC-only access to the patients/termine/patient_messages tables added in
// supabase/phase1_patients_termine_messages.sql, for patient.html/
// patient-login.html. Patients have no real Supabase Auth, so RLS grants
// them zero direct table access -- every call here goes through a
// SECURITY DEFINER RPC that resolves the patient from an opaque session
// token instead (see patient_id_from_token in the SQL file), mirroring the
// existing check_join_request_status/validate_staff_invite pattern.
//
// This is a separate file from vendor/patient-data.js (used by doctor.html/
// secretary.html) on purpose: that file's staff-mode caches call
// sb.from('termine').select('*') etc. directly at load time, which would
// just fail under RLS for an anon patient session -- patients need the
// RPC-only functions here instead, not the direct-table-access ones.
const PATIENT_TOKEN_KEY='smartordi_patient_token';
function getPatientToken(){
  return sessionStorage.getItem(PATIENT_TOKEN_KEY);
}
function setPatientToken(token){
  if(token) sessionStorage.setItem(PATIENT_TOKEN_KEY,token);
  else sessionStorage.removeItem(PATIENT_TOKEN_KEY);
}

// Returns {token,fullName,name,firstLogin,joinStatus,joinNote} on success,
// or null if the credentials are wrong or this username has no patients
// row yet (e.g. a join request that hasn't been approved) -- callers fall
// back to check_join_request_status to tell those two cases apart.
async function patientLogin(username,password){
  const {data,error}=await sb.rpc('patient_login',{p_username:username,p_password:password});
  if(error){
    // supabase/phase14_patient_login_hardening.sql -- these two are real,
    // actionable states the login screen shows a specific message for, so
    // they're re-thrown instead of silently swallowed. Anything else keeps
    // the original behavior (caller falls back to check_join_request_status).
    if(error.message&&(error.message.indexOf('account_locked')!==-1||error.message.indexOf('temp_password_expired')!==-1)){
      throw error;
    }
    console.error('patientLogin failed',error); return null;
  }
  const row=data&&data[0];
  if(!row) return null;
  return {
    token: row.token,
    fullName: row.full_name,
    name: row.name,
    firstLogin: row.first_login,
    joinStatus: row.join_status,
    joinNote: row.join_note,
    anamnese: row.anamnese,
  };
}
// ── GUARDIAN LOGIN (supabase/phase28_guardian_child_accounts.sql) -- a
// parent logging in on behalf of a child patient too young for their own
// login. A guardian is not itself a patient, so it gets its own token
// (never stored under PATIENT_TOKEN_KEY) until guardianSelectChild() mints
// a completely ordinary patient session token for the chosen child --
// every function above this comment then works unmodified from that point
// on, scoped to the child. ──
async function guardianLogin(username,password){
  const {data,error}=await sb.rpc('guardian_login',{p_username:username,p_password:password});
  if(error){ console.error('guardianLogin failed',error); return null; }
  const row=data&&data[0];
  if(!row) return null;
  return { token:row.token, guardianId:row.guardian_id, fullName:row.full_name, name:row.name, firstLogin:row.first_login };
}
async function guardianChangePassword(guardianToken,newPassword){
  const {data,error}=await sb.rpc('guardian_change_password',{p_token:guardianToken,p_new_password:newPassword});
  if(error){ console.error('guardianChangePassword failed',error); return false; }
  return !!data;
}
async function guardianGetChildren(guardianToken){
  const {data,error}=await sb.rpc('guardian_get_children',{p_token:guardianToken});
  if(error){ console.error('guardianGetChildren failed',error); return []; }
  return (data||[]).map(row=>({ id:row.id, username:row.username, name:row.name, fullName:row.full_name, fach:row.fach, dob:row.dob }));
}
async function guardianSelectChild(guardianToken,childId){
  const {data,error}=await sb.rpc('guardian_select_child',{p_token:guardianToken,p_child_id:childId});
  if(error){ console.error('guardianSelectChild failed',error); return null; }
  return data||null;
}
async function patientChangePassword(newPassword){
  const {data,error}=await sb.rpc('patient_change_password',{p_token:getPatientToken(),p_new_password:newPassword});
  if(error){ console.error('patientChangePassword failed',error); return false; }
  return !!data;
}
// supabase/phase20_patient_self_deletion.sql -- lets the patient request
// their own erasure (Art. 17 DSGVO) directly, instead of only through
// staff. Same retention-reconciliation logic as the staff-facing
// request_patient_deletion() (10-year § 51 ÄrzteG retention): anonymizes
// immediately if that period already elapsed, otherwise schedules the
// legally earliest allowed date and returns it.
async function patientRequestDeletion(){
  const {data,error}=await sb.rpc('patient_request_deletion',{p_token:getPatientToken()});
  if(error){ console.error('patientRequestDeletion failed',error); throw error; }
  return data&&data[0];
}
// supabase/phase8_anamnese.sql -- saves the mandatory first-login Anamnese
// questionnaire server-side instead of a browser-local record, so it's
// visible from any device the patient logs in from afterward.
async function patientSetAnamnese(data){
  const {data:ok,error}=await sb.rpc('patient_set_anamnese',{p_token:getPatientToken(),p_data:data});
  if(error){ console.error('patientSetAnamnese failed',error); return false; }
  return !!ok;
}
// Revokes the session token server-side (supabase/phase6_patient_logout.sql)
// -- without this, "logging out" only ever cleared the token from this
// device's sessionStorage while the token itself stayed valid (and usable
// from anywhere) for its full ~30-day expiry.
async function patientLogout(){
  const token=getPatientToken();
  if(!token) return;
  const {error}=await sb.rpc('patient_logout',{p_token:token});
  if(error) console.error('patientLogout failed',error);
}
async function patientGetProfile(){
  const {data,error}=await sb.rpc('patient_get_profile',{p_token:getPatientToken()});
  if(error){ console.error('patientGetProfile failed',error); return null; }
  const row=data&&data[0];
  if(!row) return null;
  return {
    id: row.id, username: row.username, name: row.name, fullName: row.full_name,
    fach: row.fach, dob: row.dob, adresse: row.adresse, tel: row.tel, email: row.email,
    versicherung: row.versicherung, svnr: row.svnr, firstLogin: row.first_login,
  };
}
async function patientGetMessages(){
  const {data,error}=await sb.rpc('patient_get_messages',{p_token:getPatientToken()});
  if(error){ console.error('patientGetMessages failed',error); return []; }
  return (data||[]).map(function(row){
    return {dir:row.dir, type:row.type, text:row.text, time:(row.created_at||'').slice(11,16),
      docId:row.doc_id, filename:row.filename, sub:row.doc_sub};
  });
}
async function patientSendMessage(text){
  const {data,error}=await sb.rpc('patient_send_message',{p_token:getPatientToken(),p_text:text});
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
  const {data,error}=await sb.rpc('patient_get_termine',{p_token:getPatientToken()});
  if(error){ console.error('patientGetTermine failed',error); return []; }
  return (data||[]).map(terminRowToJsPatient);
}
async function patientBookTermin(fields){
  const {data,error}=await sb.rpc('patient_book_termin',{
    p_token:getPatientToken(), p_arzt_id:fields.arztUsername, p_date:fields.date,
    p_time:fields.time, p_end_time:fields.endTime, p_art:fields.art,
  });
  if(error){ console.error('patientBookTermin failed',error); throw error; }
  return terminRowToJsPatient(data);
}
async function patientSetSymptoms(terminId,reason,reasonNote){
  const {data,error}=await sb.rpc('patient_set_symptoms',{p_token:getPatientToken(),p_termin_id:terminId,p_reason:reason,p_reason_note:reasonNote});
  if(error){ console.error('patientSetSymptoms failed',error); return false; }
  return !!data;
}
// supabase/phase2_patient_documents.sql -- documents a staff member uploaded
// for this patient (lab results, referrals...). patientGetDocuments() only
// returns metadata; the base64 file body is fetched separately per document
// via patientGetDocumentFile() so opening the list doesn't pull every file
// over the wire.
async function patientGetDocuments(){
  const {data,error}=await sb.rpc('patient_get_documents',{p_token:getPatientToken()});
  if(error){ console.error('patientGetDocuments failed',error); return []; }
  return (data||[]).map(function(row){
    return {id:row.id, category:row.category, title:row.title, filename:row.filename,
      mimeType:row.mime_type, sizeBytes:row.size_bytes, bodyText:row.body_text, createdAt:row.created_at};
  });
}
async function patientGetDocumentFile(docId){
  const {data,error}=await sb.rpc('patient_get_document_file',{p_token:getPatientToken(),p_doc_id:docId});
  if(error){ console.error('patientGetDocumentFile failed',error); return null; }
  const row=data&&data[0];
  if(!row) return null;
  return {filename:row.filename, mimeType:row.mime_type, base64:row.file_data};
}
// supabase/phase5_impfungen.sql -- unlike patient_documents/mkp_untersuchungen,
// this one exists specifically so a parent can see their child's own
// vaccination status (daycare/school proof), not just staff.
async function patientGetImpfungen(){
  const {data,error}=await sb.rpc('patient_get_impfungen',{p_token:getPatientToken()});
  if(error){ console.error('patientGetImpfungen failed',error); return []; }
  return (data||[]).map(function(row){
    return {id:row.id, vaccineKey:row.vaccine_key, vaccineName:row.vaccine_name,
      doseLabel:row.dose_label, datum:row.datum, nextDue:row.next_due, createdAt:row.created_at};
  });
}
