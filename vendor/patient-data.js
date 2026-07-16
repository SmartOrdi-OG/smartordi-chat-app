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
// past/cancelled ones stay as history.
async function bulkReassignTermine(patientName,fromArzt,toArzt,fromDate){
  const {data,error}=await sb.from('termine').update({arzt_id:toArzt})
    .eq('patient_name',patientName).eq('arzt_id',fromArzt).neq('status','abgesagt').gte('date',fromDate)
    .select();
  if(error){ console.error('bulkReassignTermine failed',error); return 0; }
  (data||[]).forEach(function(row){
    const js=terminRowToJs(row);
    const idx=_termine.findIndex(function(t){ return t.id===row.id; });
    if(idx>=0) _termine[idx]=js; else _termine.push(js);
  });
  return data?data.length:0;
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
      joinStatus: row.join_status,
      joinNote: row.join_note,
    });
  });
  // Accounts that only exist locally so far (not yet uploaded/created in
  // Supabase -- e.g. a guardian/child account, deferred to a later phase)
  // still need to show up exactly as they did before this migration.
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

// ── CHAT (patient_messages) ──
// Staff-sent messages get mirrored here (best-effort, only when the
// patient already has a Supabase identity row) so they sync across staff
// devices/browsers in real time. Since patient.html now also sends a real
// patient's own messages straight here (a later migration step), reading a
// real patient's full thread now pulls from this table too -- see
// hydrateRealThreadFromSupabase() in doctor.html/secretary.html.
async function sendMessageToPatient(patientId,msg){
  const row={patient_id:patientId, dir:msg.dir, type:msg.type||'text', text:msg.text||null};
  const {data,error}=await sb.from('patient_messages').insert(row).select().single();
  if(error){ console.error('sendMessageToPatient failed',error); throw error; }
  return data;
}
async function getMessagesForPatient(patientId){
  const {data,error}=await sb.from('patient_messages').select('*').eq('patient_id',patientId).order('created_at');
  if(error){ console.error('getMessagesForPatient failed',error); return []; }
  return data||[];
}
// Replaces the old same-browser-only 'storage' event for chat -- a real
// patient's own message (sent from their own device via patient.html) can
// only ever reach a staff device through this, since it never touches
// localStorage at all.
function subscribeMessagesRealtime(onChange){
  sb.channel('patient-messages-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'patient_messages'},function(){
      if(onChange) onChange();
    })
    .subscribe();
}
