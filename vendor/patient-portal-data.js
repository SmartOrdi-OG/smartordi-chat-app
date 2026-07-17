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
  if(error){ console.error('patientLogin failed',error); return null; }
  const row=data&&data[0];
  if(!row) return null;
  return {
    token: row.token,
    fullName: row.full_name,
    name: row.name,
    firstLogin: row.first_login,
    joinStatus: row.join_status,
    joinNote: row.join_note,
  };
}
async function patientChangePassword(newPassword){
  const {data,error}=await sb.rpc('patient_change_password',{p_token:getPatientToken(),p_new_password:newPassword});
  if(error){ console.error('patientChangePassword failed',error); return false; }
  return !!data;
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
    return {dir:row.dir, type:row.type, text:row.text, time:(row.created_at||'').slice(11,16)};
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
