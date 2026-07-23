// Shared cache-then-sync-getter access to the Termine (appointments) and
// patients (identity/contact) tables added in
// supabase/phase1_patients_termine_messages.sql -- same pattern as
// vendor/staff-accounts.js's _staffRoster/refreshStaffRoster/loadStaffAccounts/
// staffRosterReady. Loaded by doctor.html/secretary.html (staff mode: direct
// table access, RLS already grants authenticated staff full access) right
// after vendor/staff-accounts.js.
//
// Chat (patient_messages table) and patient login are migrated in later
// PRs. Clinical fields (diagnosen/allergie/blutgruppe/impfungen/anamnese)
// and messages still live in localStorage's smartordi_patient_accounts for
// now too -- loadPatients() below merges Supabase's identity/contact
// columns (now authoritative, fixes real patients differing across
// devices) with whatever clinical/local-only fields already exist for that
// username on THIS device, so every existing render/search/export function
// that reads an account object keeps working unchanged. Only the functions
// that create a patient or need "which real patients exist" need to switch
// to the new accessor -- clinical-field writes (saveAnamnese, addImpfung)
// and chat (messages) intentionally keep reading/writing the raw
// localStorage object directly until their own migration PRs land.
//
// Every Termin row coming back from Supabase is remapped into the same
// camelCase shape (patient/endTime/arztUsername/reasonNote) the app's
// existing render functions already expect, so dashboards/lists/print
// functions don't need to change at all -- only the functions that
// create/update a Termin do.
function terminRowToJs(row){
  return {
    id: row.id,
    legacyId: row.legacy_id,
    patientId: row.patient_id,
    patient: row.patient_name,
    art: row.art,
    date: row.date,
    time: row.time,
    endTime: row.end_time,
    status: row.status,
    arztUsername: row.arzt_id,
    versicherung: row.versicherung,
    tel: row.tel,
    svnr: row.svnr,
    dob: row.dob,
    reason: row.reason,
    reasonNote: row.reason_note,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

let _termine=[];
async function refreshTermine(){
  const {data,error}=await sb.from('termine').select('*').order('date').order('time');
  if(error){ console.error('refreshTermine failed',error); return; }
  _termine=(data||[]).map(terminRowToJs);
}
function loadTermine(){
  return _termine;
}
// Explicit, doctor-driven visit progress (supabase/phase7_termin_visit_state.sql)
// -- replaces guessing "now/next/past" from the clock, which breaks the
// moment the day runs behind schedule or patients are seen out of order.
async function startTerminVisit(id){
  const now=new Date().toISOString();
  const {error}=await sb.from('termine').update({started_at:now}).eq('id',id);
  if(error){ console.error('startTerminVisit failed',error); return false; }
  const t=_termine.find(x=>x.id===id);
  if(t) t.startedAt=now;
  return true;
}
async function completeTerminVisit(id){
  const now=new Date().toISOString();
  const {error}=await sb.from('termine').update({completed_at:now}).eq('id',id);
  if(error){ console.error('completeTerminVisit failed',error); return false; }
  const t=_termine.find(x=>x.id===id);
  if(t) t.completedAt=now;
  return true;
}
const termineReady=refreshTermine();

// Best-effort patient_id lookup by full name -- patients created before the
// identity migration (a later PR) won't have a row yet, so this can come
// back null; callers keep patient_name as the display fallback either way.
async function findPatientIdByFullName(fullName){
  if(!fullName) return null;
  const {data,error}=await sb.from('patients').select('id').eq('full_name',fullName).maybeSingle();
  if(error){ console.error('findPatientIdByFullName failed',error); return null; }
  return data?data.id:null;
}

async function insertTermin(fields){
  const patientId=await findPatientIdByFullName(fields.patient);
  const row={
    patient_id: patientId,
    patient_name: fields.patient,
    art: fields.art||null,
    date: fields.date,
    time: fields.time,
    end_time: fields.endTime||null,
    status: fields.status||'neu',
    arzt_id: fields.arztUsername||null,
    versicherung: fields.versicherung||null,
    tel: fields.tel||null,
    svnr: fields.svnr||null,
    dob: fields.dob||null,
  };
  const {data,error}=await sb.from('termine').insert(row).select().single();
  if(error){ console.error('insertTermin failed',error); throw error; }
  const js=terminRowToJs(data);
  _termine.push(js);
  return js;
}

async function updateTermin(id,patch){
  const dbPatch={};
  if('status' in patch) dbPatch.status=patch.status;
  if('date' in patch && patch.date) dbPatch.date=patch.date;
  if('time' in patch && patch.time) dbPatch.time=patch.time;
  if('endTime' in patch && patch.endTime) dbPatch.end_time=patch.endTime;
  if('arztUsername' in patch) dbPatch.arzt_id=patch.arztUsername||null;
  if('reason' in patch) dbPatch.reason=patch.reason;
  if('reasonNote' in patch) dbPatch.reason_note=patch.reasonNote;
  const {data,error}=await sb.from('termine').update(dbPatch).eq('id',id).select().maybeSingle();
  if(error){ console.error('updateTermin failed',error); return null; }
  if(!data) return null;
  const js=terminRowToJs(data);
  const idx=_termine.findIndex(function(t){ return t.id===id; });
  if(idx>=0) _termine[idx]=js; else _termine.push(js);
  return js;
}

// Weiterleiten (patient transfer): reassign this patient's own upcoming,
// non-cancelled appointments with the current doctor to a colleague --
// past/cancelled ones stay as history. Returns {count,error} rather than a
// bare number -- confirmTransfer() needs to tell "a real DB error
// happened" apart from "the update legitimately matched zero rows" (e.g.
// the patient simply had no upcoming appointment with this doctor), which
// a plain 0 can't distinguish.
async function bulkReassignTermine(patientName,fromArzt,toArzt,fromDate){
  const {data,error}=await sb.from('termine').update({arzt_id:toArzt})
    .eq('patient_name',patientName).eq('arzt_id',fromArzt).neq('status','abgesagt').gte('date',fromDate)
    .select();
  if(error){ console.error('bulkReassignTermine failed',error); return {count:0,error}; }
  (data||[]).forEach(function(row){
    const js=terminRowToJs(row);
    const idx=_termine.findIndex(function(t){ return t.id===row.id; });
    if(idx>=0) _termine[idx]=js; else _termine.push(js);
  });
  return {count:data?data.length:0,error:null};
}

// Replaces the old same-browser-only 'storage' event listener for the
// smartordi_termine key -- Realtime fires in every tab/device (including
// the one that made the write), so onChange may run once more than a
// storage event would have; every render function this calls is a cheap,
// idempotent full re-draw, so the extra call is harmless.
function subscribeTermineRealtime(onChange){
  sb.channel('termine-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'termine'},async function(){
      await refreshTermine();
      if(onChange) onChange();
    })
    .subscribe();
}

// ── PATIENTS (identity/contact) ──
// Merges the Supabase patients row (now authoritative for identity/contact)
// with whatever this device's own localStorage already has for that
// username -- clinical fields, messages, guardian/child links, and the
// local pw/firstLogin bookkeeping patient-login.html still depends on
// (until it's migrated in a later PR) all pass through untouched.
function localPatientAccountsRaw(){
  try{ return JSON.parse(localStorage.getItem('smartordi_patient_accounts'))||{}; }catch(e){ return {}; }
}
let _patients={};
async function refreshPatients(){
  const {data,error}=await sb.from('patients').select('*');
  if(error){ console.error('refreshPatients failed',error); return; }
  const localAccounts=localPatientAccountsRaw();
  const merged={};
  (data||[]).forEach(function(row){
    const local=localAccounts[row.username]||{};
    merged[row.username]=Object.assign({},local,{
      id: row.id,
      username: row.username,
      name: row.name,
      fullName: row.full_name,
      fach: row.fach||local.fach,
      dob: row.dob||local.dob,
      adresse: row.adresse||local.adresse,
      tel: row.tel||local.tel,
      email: row.email||local.email,
      versicherung: row.versicherung||local.versicherung,
      svnr: row.svnr||local.svnr,
      anamnese: row.anamnese||local.anamnese,
      // supabase/phase10_clinical_fields.sql -- these used to be local-only
      // (set once at account creation/CSV import and never synced), so a
      // diagnosis entered/imported on one device was invisible on any other
      // staff device viewing the same patient's Kartei.
      diagnosen: row.diagnosen||local.diagnosen,
      allergie: row.allergie||local.allergie,
      blutgruppe: row.blutgruppe||local.blutgruppe,
      legacyHistory: row.legacy_history||local.legacyHistory,
      joinStatus: row.join_status,
      joinNote: row.join_note,
    });
  });
  // Accounts that only exist locally so far (not yet uploaded/created in
  // Supabase -- e.g. a not-yet-migrated legacy guardian/child pair from
  // before supabase/phase28_guardian_child_accounts.sql) still need to show
  // up exactly as they did before this migration.
  Object.keys(localAccounts).forEach(function(u){
    if(!merged[u]) merged[u]=localAccounts[u];
  });
  _patients=merged;
}
function loadPatients(){
  return _patients;
}
const patientsReady=refreshPatients();
function findPatientByFullName(name){
  const username=Object.keys(_patients).find(function(u){ return _patients[u]&&_patients[u].fullName===name; });
  return username?{username,accounts:_patients}:null;
}
// Staff-side identity create/update -- inserts or updates just the
// identity/contact columns; never touches temp_password/pw_hash unless
// explicitly asked to (same "never clobber a real password on update" rule
// as the one-time upload migration).
async function upsertPatientIdentity(username,fields){
  const row=Object.assign({username},fields);
  const {data,error}=await sb.from('patients').upsert(row,{onConflict:'username'}).select().single();
  if(error){ console.error('upsertPatientIdentity failed',error); throw error; }
  await refreshPatients();
  return data;
}

// ── GUARDIANS (supabase/phase28_guardian_child_accounts.sql) -- a parent
// logging in on behalf of a child patient too young for their own login.
// Deliberately a separate cache/table from patients: a guardian has no
// clinical data of their own and must never show up in the staff
// "Patienten" search/list alongside real patients. ──
let _guardians={};
async function refreshGuardians(){
  const {data,error}=await sb.from('patient_guardians').select('*');
  if(error){ console.error('refreshGuardians failed',error); return; }
  const merged={};
  (data||[]).forEach(function(row){
    merged[row.username]={ id:row.id, username:row.username, name:row.name, fullName:row.full_name, firstLogin:row.first_login };
  });
  _guardians=merged;
}
function loadGuardians(){
  return _guardians;
}
const guardiansReady=refreshGuardians();
// Never touches temp_password/pw_hash unless explicitly asked to, same rule
// as upsertPatientIdentity above.
async function upsertGuardianIdentity(username,fields){
  const row=Object.assign({username},fields);
  const {data,error}=await sb.from('patient_guardians').upsert(row,{onConflict:'username'}).select().single();
  if(error){ console.error('upsertGuardianIdentity failed',error); throw error; }
  await refreshGuardians();
  return data;
}

// ── CHAT (patient_messages) ──
// Staff-sent messages get mirrored here (best-effort, only when the
// patient already has a Supabase identity row) so they sync across staff
// devices/browsers in real time. Since patient.html now also sends a real
// patient's own messages straight here (a later migration step), reading a
// real patient's full thread now pulls from this table too -- see
// hydrateRealThreadFromSupabase() in doctor.html/secretary.html.
async function sendMessageToPatient(patientId,msg){
  const row={patient_id:patientId, dir:msg.dir, type:msg.type||'text', text:msg.text||null,
    doc_id:msg.docId||null, filename:msg.filename||null, doc_sub:msg.sub||null};
  const {data,error}=await sb.from('patient_messages').insert(row).select().single();
  if(error){ console.error('sendMessageToPatient failed',error); throw error; }
  return data;
}
async function getMessagesForPatient(patientId){
  const {data,error}=await sb.from('patient_messages').select('*').eq('patient_id',patientId).order('created_at');
  if(error){ console.error('getMessagesForPatient failed',error); return []; }
  return data||[];
}
// Bulk cache (all patients at once, one query) for anything that needs to
// scan every patient's messages together -- e.g. secretary.html/doctor.html's
// "Nachrichten" preview list, which used to read only the local, dual-written
// copy of messages (acc.messages) and so never showed a real patient's own
// messages at all: those are sent straight from patient.html to this table
// since PR6 and never touch a staff device's localStorage. Same
// cache-then-sync-getter shape as _termine/_impfungen.
let _allMessagesByPatient={};
async function refreshAllMessages(){
  const {data,error}=await sb.from('patient_messages').select('*').order('created_at');
  if(error){ console.error('refreshAllMessages failed',error); return; }
  const byPatient={};
  (data||[]).forEach(function(row){
    (byPatient[row.patient_id]=byPatient[row.patient_id]||[]).push(row);
  });
  _allMessagesByPatient=byPatient;
}
// Remapped to the same {dir,type,text,time} shape acc.messages entries
// already use, so callers can treat a cached row exactly like a local one.
function loadMessagesForPatientCached(patientId){
  return (_allMessagesByPatient[patientId]||[]).map(function(row){
    return {dir:row.dir, type:row.type, text:row.text, time:(row.created_at||'').slice(11,16), createdAt:row.created_at};
  });
}
const allMessagesReady=refreshAllMessages();
// Replaces the old same-browser-only 'storage' event for chat -- a real
// patient's own message (sent from their own device via patient.html) can
// only ever reach a staff device through this, since it never touches
// localStorage at all.
function subscribeMessagesRealtime(onChange){
  sb.channel('patient-messages-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'patient_messages'},async function(){
      await refreshAllMessages();
      if(onChange) onChange();
    })
    .subscribe();
}

// ── DOCUMENTS (patient_documents, supabase/phase2_patient_documents.sql,
// supabase/phase3_patient_documents_quick_notes.sql) ──
// Lets staff attach either a PDF (file_data, a base64 string the caller has
// already produced -- e.g. via FileReader, not a raw File; this module has
// no DOM/File-API dependency of its own) or a short free-text note
// (bodyText, for point-of-care results with no report to upload, e.g. an
// in-office urine dipstick test) a patient can then see from their own
// account. Pass exactly one of doc.base64Data / doc.bodyText.
async function uploadPatientDocument(patientId,doc,uploadedBy){
  const row={
    patient_id: patientId,
    category: doc.category||'sonstiges',
    title: doc.title,
    filename: doc.filename||null,
    mime_type: doc.base64Data?(doc.mimeType||'application/pdf'):null,
    size_bytes: doc.sizeBytes||null,
    file_data: doc.base64Data||null,
    body_text: doc.bodyText||null,
    uploaded_by: uploadedBy||null,
  };
  const {data,error}=await sb.from('patient_documents').insert(row).select('id,category,title,filename,mime_type,size_bytes,body_text,created_at').single();
  if(error){ console.error('uploadPatientDocument failed',error); throw error; }
  return data;
}
async function getDocumentsForPatient(patientId){
  const {data,error}=await sb.from('patient_documents').select('id,category,title,filename,mime_type,size_bytes,body_text,created_at').eq('patient_id',patientId).order('created_at',{ascending:false});
  if(error){ console.error('getDocumentsForPatient failed',error); return []; }
  return data||[];
}
// Fetches one document's base64 body -- kept separate from
// getDocumentsForPatient so opening the list doesn't pull every file's
// full content over the wire, same split as the patient-facing RPCs.
async function getPatientDocumentFile(docId){
  const {data,error}=await sb.from('patient_documents').select('filename,mime_type,file_data').eq('id',docId).maybeSingle();
  if(error){ console.error('getPatientDocumentFile failed',error); return null; }
  if(!data) return null;
  return {filename:data.filename, mimeType:data.mime_type, base64:data.file_data};
}
async function deletePatientDocument(docId){
  const {error}=await sb.from('patient_documents').delete().eq('id',docId);
  if(error){ console.error('deletePatientDocument failed',error); throw error; }
}

// ── VISITS (patient_visits, supabase/phase27_patient_visits.sql) ──
// Kartei's "Verlauf" tab (Neue Behandlung: date/type/complaint/vitals/
// diagnosis/notes/therapy) used to live in a plain in-memory JS array with
// nothing persisting it -- every entry vanished on reload and never
// reached a second device. Staff-only, same access model as
// patient_documents: patients never read their raw visit log directly,
// only whatever a doctor explicitly sends via "Bericht senden".
async function createPatientVisit(patientId,visit,createdBy){
  const row={
    patient_id: patientId,
    visit_date: visit.date,
    visit_type: visit.type,
    beschwerde: visit.beschwerde||null,
    temperature: visit.temp||null,
    blutdruck: visit.bd||null,
    schmerz: visit.schmerz||null,
    diagnose: visit.diag||'',
    notes: visit.notes||null,
    therapy: visit.therapy||null,
    created_by: createdBy||null,
  };
  const {data,error}=await sb.from('patient_visits').insert(row).select('id,visit_date,visit_type,beschwerde,temperature,blutdruck,schmerz,diagnose,notes,therapy,created_at').single();
  if(error){ console.error('createPatientVisit failed',error); throw error; }
  return data;
}
async function getVisitsForPatient(patientId){
  const {data,error}=await sb.from('patient_visits').select('id,visit_date,visit_type,beschwerde,temperature,blutdruck,schmerz,diagnose,notes,therapy,created_at').eq('patient_id',patientId).order('visit_date',{ascending:false});
  if(error){ console.error('getVisitsForPatient failed',error); return []; }
  return data||[];
}

// ── MKP (Mutter-Kind-Pass) UNTERSUCHUNGEN -- staff-only,
// supabase/phase4_mkp_untersuchungen.sql. Never read by patient.html: the
// parents already carry the official physical booklet, this is just the
// doctor's own digital copy. One row per (patient, exam type) -- saving
// again overwrites/completes that same exam via upsert, it never creates
// duplicates.
async function getMkpExamsForPatient(patientId){
  const {data,error}=await sb.from('mkp_untersuchungen').select('*').eq('patient_id',patientId);
  if(error){ console.error('getMkpExamsForPatient failed',error); return []; }
  return data||[];
}
async function saveMkpExam(patientId,examKey,fieldData,uploadedBy){
  const row={patient_id:patientId, exam_key:examKey, data:fieldData, completed_at:new Date().toISOString(), uploaded_by:uploadedBy||null};
  const {data,error}=await sb.from('mkp_untersuchungen').upsert(row,{onConflict:'patient_id,exam_key'}).select().single();
  if(error){ console.error('saveMkpExam failed',error); throw error; }
  return data;
}

// ── IMPFUNGEN (Impfkalender), supabase/phase5_impfungen.sql ──
// Replaces the old local-only `impfungen` array (see the comment at the top
// of this file -- vaccination records were deliberately left local back in
// phase1, alongside anamnese/diagnosen). Unlike MKP, patients DO get to see
// this (parents want proof for daycare/school), via patient_get_impfungen
// in vendor/patient-portal-data.js -- so this needs the same "fetch every
// row once, cache by patient_id" shape doctor.html/secretary.html's
// due-vaccination sweep (allDueVaccinations) needs to scan every patient at
// once, not just the one currently open in Kartei.
let _impfungen={};
async function refreshImpfungen(){
  const {data,error}=await sb.from('patient_impfungen').select('*').order('datum',{ascending:false});
  if(error){ console.error('refreshImpfungen failed',error); return; }
  const byPatient={};
  (data||[]).forEach(function(row){
    (byPatient[row.patient_id]=byPatient[row.patient_id]||[]).push(row);
  });
  _impfungen=byPatient;
}
function loadImpfungenFor(patientId){
  return _impfungen[patientId]||[];
}
// Same camelCase remap idea as terminRowToJs -- keeps every render/due-check
// function working against vaccineKey/vaccineName/nextDue regardless of the
// underlying column names.
function impfRowToJs(row){
  return {id:row.id, vaccineKey:row.vaccine_key, vaccineName:row.vaccine_name,
    doseLabel:row.dose_label, datum:row.datum, nextDue:row.next_due, charge:row.charge, createdAt:row.created_at};
}
const impfungenReady=refreshImpfungen();
async function addImpfungEntry(patientId,entry,uploadedBy){
  const row={
    patient_id: patientId,
    vaccine_key: entry.vaccineKey||null,
    vaccine_name: entry.vaccineName,
    dose_label: entry.doseLabel,
    datum: entry.datum,
    next_due: entry.nextDue||null,
    charge: entry.charge||null,
    uploaded_by: uploadedBy||null,
  };
  const {data,error}=await sb.from('patient_impfungen').insert(row).select().single();
  if(error){ console.error('addImpfungEntry failed',error); throw error; }
  (_impfungen[patientId]=_impfungen[patientId]||[]).unshift(data);
  return data;
}
function subscribeImpfungenRealtime(onChange){
  sb.channel('patient-impfungen-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'patient_impfungen'},async function(){
      await refreshImpfungen();
      if(onChange) onChange();
    })
    .subscribe();
}
