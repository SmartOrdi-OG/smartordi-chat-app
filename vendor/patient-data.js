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
// Retries a query with select('*') if the explicit column list itself is
// what failed. Built after a real incident (2026-07-24): a migration
// adding patients.anamnese hadn't actually been applied on this project,
// so refreshPatients()'s explicit column list failed outright and the
// ENTIRE patient list vanished with no visible error until a doctor
// noticed live. reportCriticalDataError() (see vendor/staff-accounts.js)
// now at least surfaces that class of failure as a visible banner instead
// of silent data loss -- but this goes one step further and prevents the
// failure itself: a column missing because a migration lagged behind a
// later performance-only change degrades to "loads every column, a bit
// slower" instead of blacking out the whole feature. queryFn(columns) must
// build and await the full query (select+filters+order) for that column
// list; run supabase/schema_health_check.sql to find exactly which column
// is actually missing after a warning like this shows up.
async function selectWithColumnFallback(queryFn,explicitColumns,context){
  let {data,error}=await queryFn(explicitColumns);
  if(error){
    console.warn(context+': explicit column select failed, retrying with select(*) -- run supabase/schema_health_check.sql to find out what\'s missing.',error);
    ({data,error}=await queryFn('*'));
  }
  return {data,error};
}

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

// Fetches only the columns terminRowToJs() actually reads (skips
// updated_at/practice_id -- the latter is RLS-only bookkeeping, never
// needed once it already scoped which rows came back) -- a smaller payload
// for the exact same full-history fetch, since the Kalender/mini-calendar
// still needs every past+future termine in memory to browse back to any
// month. See the row-count warning below for when that itself needs
// revisiting (real windowing/on-demand loading, not implemented yet).
const TERMINE_COLUMNS='id,legacy_id,patient_id,patient_name,art,date,time,end_time,status,arzt_id,versicherung,tel,svnr,dob,reason,reason_note,started_at,completed_at,created_at';
// Rolling window on the past only, same reasoning as
// ALL_MESSAGES_WINDOW_DAYS above -- termine grows without bound over a
// practice's multi-year lifetime, but the actual daily workflow (today's
// schedule, the Kalender's mini-calendar/day-strip, "next appointment"
// panels, the Vertretung broadcast) only ever needs recent-past-through-
// future, never the practice's entire history at once. No upper/future
// bound: a practice's future-booked appointments are naturally
// self-limiting (nobody pre-books years ahead), so only bounding backward
// avoids ever hiding an appointment someone is actively about to have.
// A patient's own visit history for continuity-of-care purposes lives in
// the separate patient_visits table (getVisitsForPatient(), scoped to one
// patient at a time, already unaffected by this) -- not termine, so a
// termin older than this window disappearing from the live Kalender view
// doesn't lose any clinical record, just how far back the day-by-day
// schedule browser can casually scroll without a page reload.
const TERMINE_PAST_WINDOW_DAYS=730;
let _termine=[];
async function refreshTermine(){
  const cutoff=new Date(Date.now()-TERMINE_PAST_WINDOW_DAYS*24*60*60*1000).toISOString().slice(0,10);
  const {data,error}=await selectWithColumnFallback(
    cols=>sb.from('termine').select(cols).gte('date',cutoff).order('date').order('time'),
    TERMINE_COLUMNS,'refreshTermine');
  if(error){ reportCriticalDataError('refreshTermine',error); return; }
  if(data&&data.length>3000) console.warn('refreshTermine: '+data.length+' rows loaded (last '+TERMINE_PAST_WINDOW_DAYS+' days onward) -- this practice is approaching the point where even the rolling window will get noticeably slow; time to shrink the window or add real on-demand loading for the Kalender.');
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
    // CSV import (secretary.html's importTermineFromRow()) uses this for a
    // past appointment carried over from the old system -- without it, a
    // historical visit would show up as an outstanding, not-yet-happened
    // appointment (same dot/status the calendar uses for anything with no
    // completed_at), which is wrong for something that already happened.
    completed_at: fields.completedAt||null,
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
//
// Filtered to this practice's own practice_id (once known -- see
// practiceSettingsReady below) so a busy multi-practice deployment doesn't
// have every open tab, in every practice, re-fetch on every OTHER
// practice's row change in this table. termine/patient_messages/
// patient_impfungen/lab_result_uploads all carry a real practice_id column
// (phase12_multi_tenant_rls.sql onward) an RLS policy already scopes
// reads/writes by -- this filter just avoids the wasted round-trip, it
// changes no access control (RLS still applies regardless).
async function subscribeTermineRealtime(onChange){
  await practiceSettingsReady;
  const opts={event:'*',schema:'public',table:'termine'};
  const practiceId=getPracticeSettings()?.id;
  if(practiceId) opts.filter='practice_id=eq.'+practiceId;
  sb.channel('termine-changes')
    .on('postgres_changes',opts,async function(){
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
// Explicit column list for the same reason as TERMINE_COLUMNS above --
// notably excludes pw_hash/temp_password (zero legitimate use client-side,
// even though RLS already keeps them within the same practice's own staff)
// and practice_id/guardian_id (server-side/RPC-only bookkeeping).
const PATIENTS_COLUMNS='id,username,name,full_name,fach,dob,adresse,tel,email,versicherung,svnr,anamnese,diagnosen,allergie,blutgruppe,legacy_history,join_status,join_note';
// Factored out of refreshPatients() so searchPatientsServer()/
// findPatientByFullNameServer() below (and refreshPatients() itself) share
// exactly one row->JS mapping instead of drifting out of sync with each other.
function patientRowToJs(row,localAccounts){
  const local=(localAccounts||{})[row.username]||{};
  return Object.assign({},local,{
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
}
let _patients={};
// Patient search-on-demand PR6 (final phase, see TODO.md): this used to
// fetch EVERY patient row unconditionally, with only a console.warn past
// 3000 rows as a signal to eventually fix it -- now bounded outright to
// the most recently active PATIENTS_LIST_LIMIT patients (requires
// supabase/phase36_patients_search_index.sql's updated_at trigger to
// actually be live; without it, this degrades gracefully to "most
// recently created" instead of "most recently active", never a crash).
// The sidebar list/dashboard aggregates/Termin patient picker only ever
// see this bounded set from here on -- NOT yet real pagination for those
// specific features (deliberately out of scope, see TODO.md/the plan) --
// but any patient, including ones outside this bounded set, stays fully
// reachable via searchPatientsServer()/searchPatientsByCriteria()/
// findPatientRecordAsync(), which always query Supabase directly.
const PATIENTS_LIST_LIMIT=500;
async function refreshPatients(){
  const {data,error}=await selectWithColumnFallback(
    cols=>sb.from('patients').select(cols).order('updated_at',{ascending:false}).limit(PATIENTS_LIST_LIMIT),
    PATIENTS_COLUMNS,'refreshPatients');
  if(error){ reportCriticalDataError('refreshPatients',error); return; }
  if(data&&data.length>=PATIENTS_LIST_LIMIT) console.warn('refreshPatients: hit the '+PATIENTS_LIST_LIMIT+'-patient cap -- the sidebar/dashboard/Termin-picker only show the most recently active '+PATIENTS_LIST_LIMIT+' patients now. Every patient (including older/less-active ones not shown here) stays fully reachable via search.');
  const localAccounts=localPatientAccountsRaw();
  const merged={};
  (data||[]).forEach(function(row){
    merged[row.username]=patientRowToJs(row,localAccounts);
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

// ── Real paginated patient list (architecture project, see TODO.md) ──
// loadPatients()/refreshPatients() above stay as they are: a bounded,
// one-shot in-memory cache used for O(1) synchronous lookups elsewhere
// (message-count aggregation, CSV-import matching, etc.). This is a
// SEPARATE, genuinely paginated, always-accurate view of the full
// patients table meant to back the actual visible list -- doctor.html and
// secretary.html both call this (not their own separate copies of "how do
// I filter/page the list"), so there is exactly one implementation of
// that logic instead of two that can silently drift apart from each
// other (see TODO.md's chat read-receipt entry for a real example of that
// exact drift causing a bug last time).
//
// Cursor shape: {updatedAt,id} of the last row of the previous page, or
// null/undefined for the first page. Tie-broken by id (unique) because
// patients.updated_at CAN genuinely collide across different rows -- e.g.
// a single CSV-import transaction touching many rows shares one now()
// value across all of them (Postgres freezes now() per transaction, not
// per statement), so relying on updated_at alone would non-deterministically
// skip or repeat rows at that boundary. Implemented as two simple queries
// (an exact-tie bucket, then a strictly-older bucket) rather than one
// query with a nested OR/AND filter, since that's the same end result with
// far simpler filters on both ends (this app's code and PostgREST itself).
const PATIENT_LIST_PAGE_COLUMNS=PATIENTS_COLUMNS+',updated_at';
async function loadPatientListPage({cursor,pageSize}={}){
  const size=pageSize||50;
  let tieRows=[];
  if(cursor){
    const {data,error}=await selectWithColumnFallback(
      cols=>sb.from('patients').select(cols)
        .eq('updated_at',cursor.updatedAt).lt('id',cursor.id)
        .order('updated_at',{ascending:false}).order('id',{ascending:false})
        .limit(size),
      PATIENT_LIST_PAGE_COLUMNS,'loadPatientListPage (tie bucket)');
    if(error){ console.error('loadPatientListPage (tie bucket) failed',error); return {rows:[],cursor:null,hasMore:false,error}; }
    tieRows=data||[];
  }
  const remaining=size-tieRows.length;
  let olderRows=[];
  if(remaining>0){
    const {data,error}=await selectWithColumnFallback(
      cols=>{
        let q=sb.from('patients').select(cols)
          .order('updated_at',{ascending:false}).order('id',{ascending:false}).limit(remaining);
        if(cursor) q=q.lt('updated_at',cursor.updatedAt);
        return q;
      },
      PATIENT_LIST_PAGE_COLUMNS,'loadPatientListPage (older bucket)');
    if(error){ console.error('loadPatientListPage (older bucket) failed',error); return {rows:[],cursor:null,hasMore:false,error}; }
    olderRows=data||[];
  }
  const rowsRaw=tieRows.concat(olderRows);
  const localAccounts=localPatientAccountsRaw();
  const rows=rowsRaw.map(row=>patientRowToJs(row,localAccounts));
  rows.forEach(cachePatientLookup);
  const last=rowsRaw[rowsRaw.length-1];
  return {
    rows,
    cursor:last?{updatedAt:last.updated_at,id:last.id}:null,
    // Heuristic, not an exact lookahead: a full page MIGHT mean there's
    // nothing left right at the boundary, in which case the next fetch
    // simply comes back empty and the caller stops -- same tradeoff
    // real-world infinite-scroll UIs make everywhere to avoid a second
    // round-trip (a COUNT/limit(size+1) probe) on every single page.
    hasMore:rowsRaw.length>=size,
  };
}
// Real total count for the practice's own patients (RLS-scoped
// automatically, same as every other patients query) -- for the
// Dashboard/section-header counts, which previously read patients.length
// off the bounded ≤500 list and silently under-reported once a practice
// passed that size (looked like "500 Patienten" forever, never higher,
// with no error or warning).
async function countAllPatients(){
  const {count,error}=await sb.from('patients').select('id',{count:'exact',head:true});
  if(error){ console.error('countAllPatients failed',error); return null; }
  return count;
}
function findPatientByFullName(name){
  const username=Object.keys(_patients).find(function(u){ return _patients[u]&&_patients[u].fullName===name; });
  return username?{username,accounts:_patients}:null;
}

// ── Search-on-demand (supabase/phase36_patients_search_index.sql) --
// replaces scanning the full in-memory _patients dict for search boxes/
// single-patient lookups, which is what gets noticeably slow past ~3000
// patients (see the console.warn above). Not yet called anywhere in this
// PR -- purely additive, existing behavior is unchanged until later PRs
// convert real call sites over to these. ──
// Session-scoped cache of patients looked up individually (via search or a
// direct name lookup) this session -- lets most existing
// findPatientByFullName()/findPatientRecord() call sites stay SYNCHRONOUS:
// a patient already opened/searched once resolves instantly from here on
// every later call, only a true first-touch needs the async server
// round-trip below. Capped so a long session doesn't grow this
// unboundedly -- a plain Map preserves insertion order, which is all an
// LRU-ish "drop the oldest" cap needs here.
const _lookupCache=new Map();
const LOOKUP_CACHE_MAX=200;
function cachePatientLookup(account){
  if(!account||!account.fullName) return;
  _lookupCache.delete(account.fullName);
  _lookupCache.set(account.fullName,account);
  if(_lookupCache.size>LOOKUP_CACHE_MAX) _lookupCache.delete(_lookupCache.keys().next().value);
}
// Synchronous -- checks the session cache first, then whatever _patients
// (today: the full list; after a later PR: a bounded recent set) still
// holds. Returns the plain merged account object directly (or null), NOT
// the {username,accounts} shape findPatientByFullName() above returns --
// deliberately simpler, since nothing consumes this yet in this PR.
function findPatientByFullNameCached(name){
  if(_lookupCache.has(name)) return _lookupCache.get(name);
  const found=findPatientByFullName(name);
  return found?found.accounts[found.username]:null;
}
// A cache entry is keyed by fullName, but an identity EDIT is keyed by
// username -- and full_name itself might be exactly what's being
// corrected. Without this, a patient looked up once this session (search,
// Kartei open, ...) before an edit kept returning the STALE pre-edit
// identity (SVNR/insurance/etc.) for the rest of the session from every
// findPatientByFullNameCached()/findPatientAccountAsync() call site --
// including onto a freshly generated Rezept/Überweisung/Patientenbericht
// after the mistake it was meant to fix was supposedly already corrected.
// Found in a full app-wide bug audit (2026-07-29).
function invalidateLookupCacheForUsername(username){
  for(const [key,account] of _lookupCache){
    if(account&&account.username===username) _lookupCache.delete(key);
  }
}
// Live exact-name lookup against the server -- the async fallback for a
// true first-touch cache miss.
async function findPatientByFullNameServer(name){
  const {data,error}=await sb.from('patients').select(PATIENTS_COLUMNS).eq('full_name',name).maybeSingle();
  if(error){ console.error('findPatientByFullNameServer failed',error); return null; }
  if(!data) return null;
  const account=patientRowToJs(data,localPatientAccountsRaw());
  cachePatientLookup(account);
  return account;
}
// Cache-first async lookup -- the real point of PR3/4 (see TODO.md): a call
// site using this instead of findPatientByFullNameCached() stops depending
// on _patients holding everyone, since a true cache miss goes live to the
// server instead of scanning whatever _patients still has. findPatientByFull
// NameServer() above logs-and-swallows its own errors (returns null for both
// "genuinely no such patient" and "the request itself failed"), so falling
// back to the cached/full-list path on any null here is always safe today --
// _patients is still complete until a later PR bounds it, so a real
// not-found stays not-found either way, while a masked network hiccup
// recovers whatever this session already has instead of coming back empty.
async function findPatientAccountAsync(name){
  if(_lookupCache.has(name)) return _lookupCache.get(name);
  const found=await findPatientByFullNameServer(name);
  if(found) return found;
  return findPatientByFullNameCached(name);
}
// Live substring search against the server (name OR SVNr contains the
// query, case-insensitive) -- for a single unified search box. `%`/`_` are
// escaped since they're ILIKE wildcards a typed query shouldn't get to use
// as one.
async function searchPatientsServer(query,limit){
  const q=(query||'').trim();
  if(!q) return [];
  const escaped=q.replace(/[%_]/g,'\\$&');
  const {data,error}=await sb.from('patients').select(PATIENTS_COLUMNS)
    .or('full_name.ilike.%'+escaped+'%,svnr.ilike.%'+escaped+'%')
    .order('full_name')
    .limit(limit||50);
  if(error){ console.error('searchPatientsServer failed',error); return []; }
  const localAccounts=localPatientAccountsRaw();
  const results=(data||[]).map(row=>patientRowToJs(row,localAccounts));
  results.forEach(cachePatientLookup);
  return results;
}
// Live search across up to 3 INDEPENDENT criteria, ANDed together (unlike
// searchPatientsServer() above, which ORs a single query across two
// columns) -- for doctor.html's "such-name"/"such-svnr"/"such-dob" form,
// where each filled field must ALL match the same patient, and dob alone
// (with no name/SVNr text at all) is itself a valid, common search ("find
// this exact birth date"). name/svnr use substring match, dob exact.
async function searchPatientsByCriteria(criteria,limit){
  const name=(criteria&&criteria.name||'').trim();
  const svnr=(criteria&&criteria.svnr||'').trim();
  const dob=criteria&&criteria.dob;
  if(!name&&!svnr&&!dob) return [];
  let q=sb.from('patients').select(PATIENTS_COLUMNS);
  if(name) q=q.ilike('full_name','%'+name.replace(/[%_]/g,'\\$&')+'%');
  if(svnr) q=q.ilike('svnr','%'+svnr.replace(/[%_]/g,'\\$&')+'%');
  if(dob) q=q.eq('dob',dob);
  const {data,error}=await q.order('full_name').limit(limit||50);
  if(error){ console.error('searchPatientsByCriteria failed',error); return []; }
  const localAccounts=localPatientAccountsRaw();
  const results=(data||[]).map(row=>patientRowToJs(row,localAccounts));
  results.forEach(cachePatientLookup);
  return results;
}
// Staff-side identity create/update -- inserts or updates just the
// identity/contact columns; never touches temp_password/pw_hash unless
// explicitly asked to (same "never clobber a real password on update" rule
// as the one-time upload migration).
async function upsertPatientIdentity(username,fields){
  const row=Object.assign({username},fields);
  const {data,error}=await sb.from('patients').upsert(row,{onConflict:'username'}).select().single();
  if(error){ console.error('upsertPatientIdentity failed',error); throw error; }
  invalidateLookupCacheForUsername(username);
  await refreshPatients();
  cachePatientLookup(patientRowToJs(data,localPatientAccountsRaw()));
  return data;
}

// Provisions (or repairs) a real Supabase Auth user for a patient/guardian
// row -- supabase/functions/create-patient-auth-user, part of replacing
// patient_sessions/guardian_sessions with real Supabase Auth (see
// supabase/phase31_patient_auth.sql, phase33_patient_login_cutover.sql).
// Best-effort/non-blocking by design: every caller of this fires it after
// its own identity upsert already succeeded and never awaits it inline
// with the synchronous QR-credential flow, same as identityPromise
// elsewhere in this file. Login itself now requires this to have
// succeeded (patient_login_precheck/guardian_login_precheck only return a
// synthetic email once auth_user_id is set), so a transient failure here
// blocks that account's next login until a retry (e.g. a password reset)
// provisions it.
async function ensurePatientAuthUser(kind,id,opts){
  const {error}=await sb.functions.invoke('create-patient-auth-user',{body:Object.assign({kind,id},opts)});
  if(error){ console.error('ensurePatientAuthUser failed for',kind,id,error); return false; }
  return true;
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
// practice_id excluded -- RLS-only bookkeeping, never read once these rows
// already came back scoped to it.
const PATIENT_MESSAGE_COLUMNS='id,patient_id,dir,type,text,sent_by,created_at,doc_id,filename,doc_sub';
async function getMessagesForPatient(patientId){
  const {data,error}=await sb.from('patient_messages').select(PATIENT_MESSAGE_COLUMNS).eq('patient_id',patientId).order('created_at');
  if(error){ console.error('getMessagesForPatient failed',error); return []; }
  return data||[];
}
// Bulk cache (all patients at once, one query) for anything that needs to
// scan every patient's messages together -- e.g. secretary.html/doctor.html's
// "Nachrichten" preview list, which used to read only the local, dual-written
// copy of messages (acc.messages) and so never showed a real patient's own
// messages at all: those are sent straight from patient.html to this table
// since PR6 and never touch a staff device's localStorage. Same
// cache-then-sync-getter shape as _termine/_impfungen. Only fetches the
// columns loadMessagesForPatientCached() actually remaps below (this
// aggregate view is preview-only, never renders document attachments).
let _allMessagesByPatient={};
// Rolling window, not the practice's full lifetime history -- this bulk
// cache (every patient's messages, used only for the "Nachrichten" preview
// text and the unread-since-last-viewed count, see unreadCountFor() in
// secretary.html) was pulling every row ever sent, for every patient, on
// every page load, which really does grow without bound over a practice's
// multi-year lifetime. A patient's full per-conversation history is
// unaffected -- getMessagesForPatient() above still loads it all the
// moment that specific chat is actually opened, one patient at a time
// (naturally bounded by that one patient's own message count, never
// multiplied across everyone else's). 365 days keeps unread-tracking
// correct for any patient staff has been reasonably attentive to (a
// message sitting unread for over a year is already a workflow problem
// this window doesn't need to solve); a patient whose last real message
// predates the window just shows "Noch keine Nachrichten" in the preview
// instead of a very old one -- cosmetic, not data loss.
const ALL_MESSAGES_WINDOW_DAYS=365;
async function refreshAllMessages(){
  const cutoff=new Date(Date.now()-ALL_MESSAGES_WINDOW_DAYS*24*60*60*1000).toISOString();
  const {data,error}=await selectWithColumnFallback(
    cols=>sb.from('patient_messages').select(cols).gte('created_at',cutoff).order('created_at'),
    'patient_id,dir,type,text,created_at','refreshAllMessages');
  if(error){ reportCriticalDataError('refreshAllMessages',error); return; }
  if(data&&data.length>3000) console.warn('refreshAllMessages: '+data.length+' rows loaded (last '+ALL_MESSAGES_WINDOW_DAYS+' days) -- this practice is approaching the point where even the rolling window will get noticeably slow; time to shrink the window or move unread-tracking server-side.');
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
// Coalesces a burst of realtime events into a single call of `fn` -- a busy
// multi-staff practice can get many patient_messages inserts within a few
// seconds (several patients messaging around the same time), and both
// doctor.html's renderPatientList() and secretary.html's
// renderRealPatientRows() rebuild the ENTIRE patient list DOM from scratch
// on every single call. Not used for a doctor/secretary's OWN direct
// actions (sending a message should still re-render immediately) -- only
// for realtime-triggered re-renders, where a couple hundred ms of delay is
// invisible but skipping N-1 redundant full rebuilds during a burst isn't.
function debounce(fn,ms){
  let t=null;
  return function(...args){
    clearTimeout(t);
    t=setTimeout(()=>fn(...args),ms);
  };
}
// Replaces the old same-browser-only 'storage' event for chat -- a real
// patient's own message (sent from their own device via patient.html) can
// only ever reach a staff device through this, since it never touches
// localStorage at all.
// Practice-scoped filter -- see subscribeTermineRealtime()'s own comment above.
async function subscribeMessagesRealtime(onChange){
  await practiceSettingsReady;
  const opts={event:'*',schema:'public',table:'patient_messages'};
  const practiceId=getPracticeSettings()?.id;
  if(practiceId) opts.filter='practice_id=eq.'+practiceId;
  sb.channel('patient-messages-changes')
    .on('postgres_changes',opts,async function(){
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

// ── REZEPTE / ÜBERWEISUNGEN (structured storage), supabase/
// phase38_rezepte_ueberweisungen.sql -- until this, Rezept/Überweisung
// existed ONLY as a generated PDF (patient_documents); the actual
// medication/referral data lived only in doctor.html's form fields at
// generation time and was never persisted structured. These insert
// alongside (not instead of) that existing PDF upload, linked via
// documentId when one was actually generated/sent that same call.
const REZEPT_COLUMNS='id,datum,med1,packungen1,dosierung1,med2,packungen2,dosierung2,med3,packungen3,dosierung3,med4,packungen4,dosierung4,notizen,rezeptgebuehrenbefreit,document_id,created_at';
async function createPatientRezept(patientId,fields,createdBy,documentId){
  const row={
    patient_id: patientId,
    datum: fields.datum||new Date().toISOString().slice(0,10),
    med1: fields.med1||null, packungen1: fields.pack1||null, dosierung1: fields.dose1||null,
    med2: fields.med2||null, packungen2: fields.pack2||null, dosierung2: fields.dose2||null,
    med3: fields.med3||null, packungen3: fields.pack3||null, dosierung3: fields.dose3||null,
    med4: fields.med4||null, packungen4: fields.pack4||null, dosierung4: fields.dose4||null,
    notizen: fields.notes||null,
    rezeptgebuehrenbefreit: !!fields.befreit,
    document_id: documentId||null,
    created_by: createdBy||null,
  };
  const {data,error}=await sb.from('patient_rezepte').insert(row).select(REZEPT_COLUMNS).single();
  if(error){ console.error('createPatientRezept failed',error); throw error; }
  return data;
}
async function getRezepteForPatient(patientId){
  const {data,error}=await sb.from('patient_rezepte').select(REZEPT_COLUMNS).eq('patient_id',patientId).order('datum',{ascending:false});
  if(error){ console.error('getRezepteForPatient failed',error); return []; }
  return data||[];
}
async function createPatientUeberweisung(patientId,fields,createdBy,documentId){
  const row={
    patient_id: patientId,
    datum: fields.datumIso||new Date().toISOString().slice(0,10),
    kostentraeger: fields.kt||null,
    status_code: fields.status||null,
    von: fields.von||null,
    an: fields.an||'',
    fachrichtung: fields.fach||null,
    dringlichkeit: fields.dring||null,
    diagnose: fields.diag||null,
    wegen: fields.wegen||null,
    notizen: fields.notes||null,
    arbeitsunfaehig: !!fields.au,
    rezeptgebuehrenbefreit: !!fields.rez,
    document_id: documentId||null,
    created_by: createdBy||null,
  };
  const {data,error}=await sb.from('patient_ueberweisungen').insert(row).select('id,datum,kostentraeger,status_code,von,an,fachrichtung,dringlichkeit,diagnose,wegen,notizen,arbeitsunfaehig,rezeptgebuehrenbefreit,document_id,created_at').single();
  if(error){ console.error('createPatientUeberweisung failed',error); throw error; }
  return data;
}
async function getUeberweisungenForPatient(patientId){
  const {data,error}=await sb.from('patient_ueberweisungen').select('id,datum,kostentraeger,status_code,von,an,fachrichtung,dringlichkeit,diagnose,wegen,notizen,arbeitsunfaehig,rezeptgebuehrenbefreit,document_id,created_at').eq('patient_id',patientId).order('datum',{ascending:false});
  if(error){ console.error('getUeberweisungenForPatient failed',error); return []; }
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
// uploaded_by/practice_id excluded -- never read by impfRowToJs() below.
const IMPFUNGEN_COLUMNS='id,patient_id,vaccine_key,vaccine_name,dose_label,datum,next_due,charge,created_at';
let _impfungen={};
async function refreshImpfungen(){
  const {data,error}=await selectWithColumnFallback(
    cols=>sb.from('patient_impfungen').select(cols).order('datum',{ascending:false}),
    IMPFUNGEN_COLUMNS,'refreshImpfungen');
  if(error){ reportCriticalDataError('refreshImpfungen',error); return; }
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
// Practice-scoped filter -- see subscribeTermineRealtime()'s own comment above.
async function subscribeImpfungenRealtime(onChange){
  await practiceSettingsReady;
  const opts={event:'*',schema:'public',table:'patient_impfungen'};
  const practiceId=getPracticeSettings()?.id;
  if(practiceId) opts.filter='practice_id=eq.'+practiceId;
  sb.channel('patient-impfungen-changes')
    .on('postgres_changes',opts,async function(){
      await refreshImpfungen();
      if(onChange) onChange();
    })
    .subscribe();
}
