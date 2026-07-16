// Shared cache-then-sync-getter access to the Termine (appointments) table
// added in supabase/phase1_patients_termine_messages.sql -- same pattern as
// vendor/staff-accounts.js's _staffRoster/refreshStaffRoster/loadStaffAccounts/
// staffRosterReady, just for termine. Loaded by doctor.html/secretary.html
// (staff mode: direct table access, RLS already grants authenticated staff
// full access) right after vendor/staff-accounts.js.
//
// Patient identity (patients table) and chat (patient_messages table) are
// migrated in later PRs -- this file only covers termine for now, so
// termine rows keep a plain patient_name string alongside the (possibly
// null, until a matching patients row exists) patient_id FK.
//
// Every row coming back from Supabase is remapped into the same camelCase
// shape (patient/endTime/arztUsername/reasonNote) the app's existing
// render functions already expect, so dashboards/lists/print functions
// don't need to change at all -- only the functions that create/update a
// Termin do.
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
