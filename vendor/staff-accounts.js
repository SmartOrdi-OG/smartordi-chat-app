// Shared staff (Arzt/Sekretär:in) account store and invite-link helpers.
// Backed by a real Supabase project (Postgres + Auth) instead of
// localStorage, so an invite link generated on one device is actually
// visible/usable on a colleague's own separate device.
//
// Login/signup happens via Supabase Auth (real e-mail + password); the
// staff_profiles table (role, fach, isAdmin, ...) is keyed by the Auth
// user's UUID. Everywhere in the app that used to treat "username" as an
// opaque string key (arztUsername on Termine, dropdown option values, the
// sessionStorage.smartordi_user snapshot) keeps working unchanged -- it's
// just a UUID now instead of a human-typed username.
//
// Every plan (Basic/Pro/Enterprise) allows an unlimited number of Ärzte and
// Sekretär:innen -- there is no seat-count gating here, only the separate
// feature flags in doctor.html's PLAN_FEATURES (Rezept/Impfpass, patient
// limits, API).

const SUPABASE_URL='https://ewilgwndhpxibkogxqbk.supabase.co';
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3aWxnd25kaHB4aWJrb2d4cWJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NjEyMjUsImV4cCI6MjA5OTUzNzIyNX0.hZeILrp_GmOzZUImEtWhdbURLqDcvr5kB8KbhLPZvVM';
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);

// A real production incident: sessionStorage.smartordi_user (this app's own
// "am I logged in" flag, read by currentStaffSession()) can outlive the
// actual Supabase Auth session it was created from. The observed symptom
// was a doctor.html that LOOKED normally logged in (name/menu rendered
// fine) while every refresh*() call below silently returned zero rows --
// an unauthenticated/invalid request just doesn't match any "to
// authenticated" RLS policy, which is a legitimate empty result, not a
// Postgres *error*, so the existing critical-data-error banner
// (reportCriticalDataError()) never fired either. The doctor saw an empty
// calendar/patient list and a Praxisprofil save that failed with no clear
// reason, with nothing telling them their LOGIN was the actual problem.
// Logging out and back in (which always re-derives everything fresh from a
// real sb.auth call) fixed it completely -- confirming exactly this.
//
// Scoped to staff roles only (arzt/sekretaerin) -- this file is also
// loaded by patient.html, where a cached session can legitimately be a
// local-only/demo/guardian account with no real sb.auth session behind it
// at all, and by login.html/register.html, where there is no cached
// session yet. Runs once per page load, before any page-specific script
// has a chance to read currentStaffSession() or rely on a refresh*() call
// that silently came back empty.
(async function guardAgainstStaleLoginSession(){
  let cached=null;
  try{ cached=JSON.parse(sessionStorage.getItem('smartordi_user')); }catch(e){}
  if(!cached||(cached.role!=='arzt'&&cached.role!=='sekretaerin')) return;
  const { data }=await sb.auth.getSession();
  if(!data||!data.session){
    sessionStorage.removeItem('smartordi_user');
    window.location.href='login.html?expired=1';
  }
})();

// Shared XSS-safety helper -- every page renders user-controlled text
// (chat messages, patient/staff names, filenames, free-text form answers)
// via innerHTML template literals rather than textContent, so any such
// value must be passed through this before interpolation.
const HTML_ESCAPE_MAP={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
function escapeHtml(str){
  if(str===null||str===undefined) return '';
  return String(str).replace(/[&<>"']/g, c=>HTML_ESCAPE_MAP[c]);
}

// Lets doctor.html/secretary.html show a persistent, hard-to-miss warning
// when a core clinical data cache (patients, termine, staff roster, ...)
// fails to load -- a real production incident showed that a failed
// refresh*() call previously just logged to the console and left its
// cache empty, which looks EXACTLY like "this practice genuinely has no
// patients" to the doctor/secretary actually looking at the screen (no
// visible error at all). Queues failures that happen before
// setCriticalDataErrorHandler() is registered, since some refresh*() calls
// fire the instant their script loads, before the page's own
// window.load handler has a chance to run.
let _onCriticalDataError=null;
let _pendingCriticalDataErrors=[];
function setCriticalDataErrorHandler(fn){
  _onCriticalDataError=fn;
  _pendingCriticalDataErrors.forEach(function(e){ fn(e.context,e.error); });
  _pendingCriticalDataErrors=[];
}
function reportCriticalDataError(context,error){
  console.error(context+' failed',error);
  if(_onCriticalDataError) _onCriticalDataError(context,error);
  else _pendingCriticalDataErrors.push({context,error});
  logClientErrorRemotely(context,error);
}
// supabase/phase46_client_error_log.sql -- the banner above is 100% local to
// whichever browser tab happened to be open the moment a critical refresh()
// failed; this is what lets the practice owner see "this practice hit a
// data-load failure" from the Supabase dashboard/SQL editor without being
// physically at that device when it happened. Fire-and-forget on purpose --
// never awaited, and any failure here is swallowed rather than surfaced,
// since logging the error must never itself become a new source of errors
// or delay the local banner above.
function logClientErrorRemotely(context,error){
  try{
    sb.from('client_error_log').insert({
      context,
      error_message:(error&&error.message)?String(error.message).slice(0,2000):null,
      page:(window.location.pathname.split('/').pop()||null),
    }).then(function(){},function(){});
  }catch(e){ /* swallow -- see comment above */ }
}

// Shared bookable-appointment-slot grid, now derived per weekday from the
// practice's own configured Öffnungszeiten (supabase/phase29_practice_
// working_hours.sql) instead of one hardcoded schedule -- both the patient-
// facing self-booking picker (patient.html) and staff's own booking forms
// (secretary.html) generate their slot list from this single source instead
// of separately hand-typed option lists, which had drifted inconsistent
// with each other (different intervals, missing slots) before this existed.
const WEEKDAY_KEYS=['sun','mon','tue','wed','thu','fri','sat']; // matches Date.getDay()
// Falls back to this whenever a practice hasn't configured its own hours
// yet (practices.working_hours is null) -- the fixed Mon-Fri 08:00-11:30/
// 14:00-16:00 schedule every practice used before Öffnungszeiten existed,
// so nothing changes for a practice that never opens those settings.
const DEFAULT_WORKING_HOURS={
  mon:{open:true,blocks:[['08:00','11:30'],['14:00','16:00']]},
  tue:{open:true,blocks:[['08:00','11:30'],['14:00','16:00']]},
  wed:{open:true,blocks:[['08:00','11:30'],['14:00','16:00']]},
  thu:{open:true,blocks:[['08:00','11:30'],['14:00','16:00']]},
  fri:{open:true,blocks:[['08:00','11:30'],['14:00','16:00']]},
  sat:{open:false,blocks:[]},
  sun:{open:false,blocks:[]},
};
function workingHoursFor(dateStr,hours){
  const key=WEEKDAY_KEYS[new Date(dateStr+'T00:00:00').getDay()];
  return (hours&&hours[key])||{open:false,blocks:[]};
}
function isWorkDay(dateStr,hours){
  return !!workingHoursFor(dateStr,hours).open;
}
// Steps every configured [start,end] block by 15 minutes -- one shared
// generator instead of a separately hand-typed option list per block.
function buildTimeSlotsFromBlocks(blocks){
  const slots=[];
  (blocks||[]).forEach(function(block){
    let [h,m]=block[0].split(':').map(Number);
    const [toH,toM]=block[1].split(':').map(Number);
    while(h<toH||(h===toH&&m<=toM)){
      slots.push(String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'));
      m+=15; if(m>=60){m=0;h++;}
    }
  });
  return slots;
}
// "Bis" (end-time) options need something *after* the last bookable start of
// each block -- otherwise picking that last start leaves no nearby valid end
// option, and syncEndTimeAfterStart's "first option greater than start"
// search would jump all the way to the next block (e.g. spanning a whole
// lunch break) instead of a sensible ~15-30 minutes later. Extends every
// block's own end by 30 minutes for that reason.
function buildEndSlotsFromBlocks(blocks){
  const extended=(blocks||[]).map(function(b){
    const [h,m]=b[1].split(':').map(Number);
    let total=((h*60+m+30)%1440+1440)%1440;
    return [b[0], String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0')];
  });
  return buildTimeSlotsFromBlocks(extended);
}
// Real interval overlap (half-open [start,end)) instead of exact start-time
// matching -- two appointments with different start times can still
// genuinely overlap (e.g. 09:00-09:45 conflicts with a 09:15 booking), which
// comparing only the start time would silently miss.
function timeRangesOverlap(aStart,aEnd,bStart,bEnd){
  return aStart<bEnd && bStart<aEnd;
}

// In-memory cache of every staff_profiles row, keyed by uuid -- refreshed
// once (awaited) during each page's init so the many existing synchronous
// call sites (arztAccounts, arztDisplayName, renderTeamCard...) don't all
// need to become async themselves.
let _staffRoster={};
async function refreshStaffRoster(){
  const {data,error}=await sb.from('staff_profiles').select('*');
  if(error){ reportCriticalDataError('refreshStaffRoster',error); return; }
  const next={};
  (data||[]).forEach(p=>{
    next[p.id]={
      vorname:p.vorname, nachname:p.nachname, fullName:p.full_name,
      role:p.role, fach:p.fach, isAdmin:p.is_admin, email:p.email,
      stempelDataUrl:p.stempel_data_url||'', sigDataUrl:p.sig_data_url||'',
    };
  });
  _staffRoster=next;
}
function loadStaffAccounts(){
  return _staffRoster;
}
// Kicked off immediately as this script loads (before any page-specific
// inline script runs), so the fetch is already in flight by the time a page
// wants to gate its first render on it via: await staffRosterReady
const staffRosterReady=refreshStaffRoster();

// Every "✗ Speichern fehlgeschlagen" toast in Einstellungen used to show
// that exact same generic text no matter what actually went wrong -- a
// real production report (a practice's Praxisprofil save failing every
// time) had nothing more specific to go on than that one line, and the
// actual Postgres/PostgREST error (RLS rejection, a missing column, a
// stale id, ...) was only ever visible in the browser console, which most
// users never open. Every save*() below now stashes its own failure here
// so the caller's toast can show the real reason inline instead.
let _lastSaveError=null;
function getLastSaveError(){ return _lastSaveError; }
function saveErrorMessage(error){
  return (error&&(error.message||error.hint||error.details))||'Unbekannter Fehler';
}

// Persists a doctor's own signature/stamp (supabase/phase23_staff_
// signature_stamp.sql) -- staffId is always the CALLER's own id in every
// real call site (doctor.html only ever saves its own logged-in doctor's
// signature), never another staff member's.
async function saveStaffSignature(staffId,fields){
  const {data,error}=await sb.from('staff_profiles').update(fields).eq('id',staffId).select().single();
  if(error){ console.error('saveStaffSignature failed',error); _lastSaveError=error; return false; }
  if(_staffRoster[staffId]){
    _staffRoster[staffId].stempelDataUrl=data.stempel_data_url||'';
    _staffRoster[staffId].sigDataUrl=data.sig_data_url||'';
  }
  return true;
}
// Persists the doctor's own name/Fachrichtung from Einstellungen
// (staff_profiles.vorname/nachname/fach) -- the settings form used to only
// update the on-screen name and a localStorage shadow copy, so the edit
// silently reverted to the old server value on reload or from any other
// device. `fields` must never include full_name -- it's a DB-generated
// column (computed from vorname+nachname), and Postgres rejects any
// direct write to it (error 428C9).
async function saveStaffProfileFields(staffId,fields){
  const {data,error}=await sb.from('staff_profiles').update(fields).eq('id',staffId).select().single();
  if(error){ console.error('saveStaffProfileFields failed',error); _lastSaveError=error; return false; }
  if(_staffRoster[staffId]){
    _staffRoster[staffId].fullName=data.full_name;
    _staffRoster[staffId].vorname=data.vorname;
    _staffRoster[staffId].nachname=data.nachname;
    _staffRoster[staffId].fach=data.fach;
  }
  return true;
}

// register.html used to create the practices + staff_profiles rows
// immediately after sb.auth.signUp(), unconditionally. That silently broke
// registration for anyone signing up on a Supabase project with "Confirm
// email" enabled (the default): signUp() still creates the auth user, but
// returns no active session until the confirmation link is clicked, so the
// very next sb.from('practices').insert() ran as an unauthenticated
// request and was rejected by phase15's "insert new practice ... to
// authenticated" RLS policy -- "Konto wurde erstellt, aber die Praxis
// konnte nicht angelegt werden: new row violates row-level security
// policy for table practices".
//
// Fix: register.html now only stashes the submitted form fields as Auth
// user_metadata (available immediately, survives the confirmation wait --
// it's part of auth.users, not a table this RLS gap affects) and defers
// actually creating the practice/profile until this function runs with a
// genuine authenticated session -- either right away (confirmation
// disabled, signUp() already returned a session) or on the user's first
// successful login.html sign-in after confirming (see doLogin() there).
// staff_profiles.full_name is a GENERATED column (vorname+nachname) --
// never written directly, same as saveStaffProfileFields() above.
async function completePendingPracticeRegistration(user){
  const m=user.user_metadata||{};
  const {data:practiceRow,error:practiceError}=await sb.from('practices').insert({
    name:m.ordination, adresse:m.adresse, tel:m.tel, plan:m.plan||'standard', trial_start:new Date().toISOString(),
  }).select().single();
  if(practiceError) return {success:false, stage:'practice', error:practiceError};
  const {error:profileError}=await sb.from('staff_profiles').insert({
    id:user.id, vorname:m.vorname, nachname:m.nachname, role:'arzt', fach:m.fach, is_admin:true, email:user.email, practice_id:practiceRow.id,
  });
  if(profileError) return {success:false, stage:'profile', error:profileError};
  const fullName=(m.titel?m.titel+' ':'')+m.vorname+' '+m.nachname;
  // Fire-and-forget, same as register.html's original record_consent call --
  // evidence-of-consent must never block/undo an already-created account.
  sb.rpc('record_consent',{
    p_practice_id:practiceRow.id, p_consent_type:'doctor_registration',
    p_full_name:fullName, p_email:user.email, p_policy_version:m.policy_version||'2.1',
    p_user_agent:navigator.userAgent,
  }).then(({error})=>{ if(error) console.error('record_consent failed',error); });
  sb.auth.updateUser({data:{pending_practice_registration:false}}).catch(()=>{});
  return {success:true, practiceId:practiceRow.id, fullName};
}

// Practice-wide settings (plan, ordination/adresse/tel, trial, payment) --
// lives on the practice's own row in `practices` (supabase/phase18_practices_
// consolidation.sql), scoped by the "view own practice"/"update own
// practice" RLS policies from phase15 (id = current_practice_id()). Used
// to live on a separate practice_settings table with a hardcoded single
// row (id=true) -- that was fine back when there was only ever one
// practice in the whole database, but became an active bug once more than
// one practice could register: every practice's plan/trial/contact info
// upserted into that same one row, clobbering every other practice's data.
let _practiceSettings=null;
async function refreshPracticeSettings(){
  // No .eq('id', ...) filter needed -- RLS already restricts a staff
  // member to seeing only their own practice's row, so this always
  // resolves to "my practice" without the client needing to know its id
  // up front (same transparent-RLS-filtering pattern as patients/termine).
  const {data,error}=await sb.from('practices').select('*').limit(1).maybeSingle();
  if(error){ reportCriticalDataError('refreshPracticeSettings',error); return; }
  _practiceSettings=data||null;
}
function getPracticeSettings(){
  return _practiceSettings;
}
// ══ PLAN / PAKET ══ (2026-07-29 repricing: 2 tiers -- Standard and
// Enterprise -- plus an Enterprise-only annual billing option with a
// discount, replacing the old Basic/Pro/Enterprise 3-tier lineup. Moved
// here from doctor.html so secretary.html can also enforce the
// per-plan patient-count cap and upload-size limit below, not just show
// the plan in Einstellungen -- doctor.html and secretary.html both
// already load this file via <script src="vendor/staff-accounts.js">.
// patientLimit:null means unlimited. uploadMaxBytes gates every PDF/ZIP
// upload check in doctor.html and secretary.html.
const PLAN_FEATURES = {
  standard: {
    label:'Standard', price:'€149', billingPeriod:'Monat',
    patientLimit:250, uploadMaxBytes:8*1024*1024,
    rezeptImpfung:true, sekretaerin:true,
    bullets:['Ärzte & Sekretär/innen: unbegrenzt','Bis 250 Patienten','Chat, Kartei, Rezept & Impfpass','Uploads bis 8 MB'],
  },
  enterprise: {
    label:'Enterprise', price:'€349', billingPeriod:'Monat',
    patientLimit:null, uploadMaxBytes:25*1024*1024,
    rezeptImpfung:true, sekretaerin:true,
    bullets:['Ärzte & Sekretär/innen: unbegrenzt','Unbegrenzte Patienten','Alles in Standard','Uploads bis 25 MB'],
  },
  enterprise_annual: {
    label:'Enterprise (jährlich)', price:'€3.490', billingPeriod:'Jahr',
    patientLimit:null, uploadMaxBytes:25*1024*1024,
    rezeptImpfung:true, sekretaerin:true,
    bullets:['Ärzte & Sekretär/innen: unbegrenzt','Unbegrenzte Patienten','Alles in Enterprise','2 Monate gratis (jährliche Abrechnung)'],
  },
};
function getPlan(){
  const p=getPracticeSettings()?.plan;
  return PLAN_FEATURES[p]?p:'standard';
}
function planHasFeature(feature){
  return !!PLAN_FEATURES[getPlan()][feature];
}
// null means unlimited (Enterprise/Enterprise-annual).
function getPlanPatientLimit(){
  return PLAN_FEATURES[getPlan()].patientLimit;
}
function getPlanUploadMaxBytes(){
  return PLAN_FEATURES[getPlan()].uploadMaxBytes;
}
function formatUploadMaxLabel(){
  return Math.round(getPlanUploadMaxBytes()/(1024*1024))+' MB';
}
// Live count against the actual `patients` table (RLS already scopes this
// to the caller's own practice, same pattern as patient_messages' own
// count query in doctor.html) -- checked at every patient-creation entry
// point in secretary.html before the row is actually created, since the
// bullet-point "Bis 500 Patienten" text alone never blocked anything
// (found in the 2026-07-29 pricing audit: no cap was enforced anywhere).
async function isPatientLimitReached(){
  const limit=getPlanPatientLimit();
  if(limit===null||limit===undefined) return false;
  const {count,error}=await sb.from('patients').select('id',{count:'exact',head:true});
  if(error){ console.error('isPatientLimitReached: count query failed',error); return false; }
  return (count||0)>=limit;
}
// Staff-side accessor for the practice's own configured Öffnungszeiten --
// patient.html can't use this (no direct table access under RLS), it fetches
// the same data via patient_get_working_hours() instead (vendor/patient-
// portal-data.js) and falls back to this same DEFAULT_WORKING_HOURS itself.
function getWorkingHours(){
  return (_practiceSettings&&_practiceSettings.working_hours)||DEFAULT_WORKING_HOURS;
}
// supabase/phase34_chat_toggle.sql -- practice-wide "Chat aktivieren"
// setting (doctor.html Einstellungen). Defaults to enabled (`!== false`,
// not `=== true`) so every existing practice -- whose row predates this
// column and therefore has chat_enabled null -- keeps chat working exactly
// as before, rather than the feature silently going dark for everyone
// until a doctor happens to open Einstellungen and re-save it.
function isChatEnabled(){
  return _practiceSettings?.chat_enabled!==false;
}
// supabase/phase44_online_booking_toggle.sql -- practice-wide "Online-
// Terminbuchung" switch (secretary.html Terminverwaltung). Same fail-open
// default reasoning as isChatEnabled() above: a practice row predating
// this column has online_booking_enabled null, which must keep booking
// working exactly as before rather than silently blocking every patient.
function isOnlineBookingEnabled(){
  return _practiceSettings?.online_booking_enabled!==false;
}
async function savePracticeSettings(fields){
  if(!_practiceSettings||!_practiceSettings.id){
    console.error('savePracticeSettings called before practice settings loaded');
    _lastSaveError={message:'Praxis-Einstellungen sind noch nicht geladen -- bitte kurz warten und erneut versuchen.'};
    return false;
  }
  const {data,error}=await sb.from('practices').update(fields).eq('id',_practiceSettings.id).select().single();
  if(error){ console.error('savePracticeSettings failed',error); _lastSaveError=error; return false; }
  _practiceSettings=data;
  return true;
}
const practiceSettingsReady=refreshPracticeSettings();
// Without this, a practice's settings (Adresse/Telefon/"Chat aktivieren")
// only ever refreshed on a full page reload -- one doctor toggling chat off
// in Einstellungen left every OTHER already-open doctor.html/secretary.html
// tab (their own or a colleague's) silently showing the old value, with
// isChatEnabled()/getPracticeSettings() answering from stale cached data
// until someone happened to reload. Staff already have a direct "view own
// practice" RLS policy on `practices` (phase15_staff_practice_rls.sql), so
// this needs no new SQL, unlike patient.html's chat-enabled flag (fetched
// once via an RPC, since patients have no direct table access at all).
// Filtered to this practice's own row (once known) so a multi-practice
// deployment doesn't have every open tab, in every practice, re-fetch on
// every OTHER practice's settings change. `practices` IS the practice row
// (no separate practice_id column -- filter on its own `id` instead, unlike
// every other subscribeXRealtime() here which filters a child table's
// practice_id foreign key).
async function subscribePracticeSettingsRealtime(onChange){
  await practiceSettingsReady;
  const opts={event:'*',schema:'public',table:'practices'};
  const practiceId=getPracticeSettings()?.id;
  if(practiceId) opts.filter='id=eq.'+practiceId;
  sb.channel('practice-settings-changes')
    .on('postgres_changes',opts,async function(){
      await refreshPracticeSettings();
      if(onChange) onChange();
    })
    .subscribe();
}

// ── Lab result inbox (supabase/phase24_lab_result_inbox.sql) ──
// A lab's own LIS already e-mails results automatically to whatever
// address the ordering doctor gave it -- nothing changes on the lab's
// side. Each practice gets its own dedicated inbound address instead of
// a doctor's personal one; cloudflare/email-worker catches mail sent to
// this domain (Cloudflare Email Routing, free) and forwards a parsed
// JSON payload to supabase/functions/receive-lab-email (not called by
// the browser), which drops one row here per e-mail attachment for a
// doctor to review and attach to the right patient's file.
//
// Domain that must have Cloudflare Email Routing enabled -- one-time
// setup outside this codebase, done by whoever administers the
// smartordi.eu domain (see cloudflare/email-worker's own header comment).
const LAB_INBOUND_DOMAIN='labs.smartordi.eu';
function labInboundEmailAddress(token){
  return `lab-${token}@${LAB_INBOUND_DOMAIN}`;
}
// Generates the practice's token once and persists it -- every call
// after the first just returns the same address, same lazy-generate-once
// shape as a staff invite link.
async function ensureLabEmailToken(){
  await practiceSettingsReady;
  const existing=getPracticeSettings()?.lab_email_token;
  if(existing) return existing;
  // Raw random hex, no prefix -- labInboundEmailAddress() already adds the
  // "lab-" prefix that receive-lab-email's tokenFromRecipient() strips back
  // off, so prefixing it here too would just double it up.
  const token=genStaffInviteToken().slice(4);
  const ok=await savePracticeSettings({lab_email_token:token});
  return ok ? token : null;
}
async function getPendingLabResults(){
  const {data,error}=await sb.from('lab_result_uploads').select('*').eq('status','pending').order('created_at',{ascending:false});
  if(error){ console.error('getPendingLabResults failed',error); return []; }
  return data||[];
}
// Copies the pending row's file into the matched patient's own Dokumente
// (uploadPatientDocument, vendor/patient-data.js) under the 'labor'
// category, then marks the inbox row as attached -- mirrors how the
// Kartei "Dokumente" tab / chat attachments already land in the same
// patient_documents table.
async function attachLabResultToPatient(labResultId,patientId,uploadedBy){
  const {data:row,error:fetchErr}=await sb.from('lab_result_uploads').select('*').eq('id',labResultId).single();
  if(fetchErr||!row){ console.error('attachLabResultToPatient: row not found',fetchErr); return false; }
  // uploadPatientDocument() throws on failure (doesn't return false) --
  // uncaught here, that exception would propagate straight out of
  // assignLabResult() in doctor.html too (it has no try/catch of its own
  // either), so a real DB error would silently abort the whole assignment
  // with no toast at all -- not even the "✗ Zuordnung fehlgeschlagen" error
  // path, since the code would never reach that check.
  try{
    await uploadPatientDocument(patientId,{
      category:'labor', title:row.subject||'Laborbefund', filename:row.filename,
      mimeType:row.mime_type, base64Data:row.file_data,
    },uploadedBy);
  }catch(err){
    console.error('attachLabResultToPatient: uploadPatientDocument failed',err);
    return false;
  }
  const {error:updateErr}=await sb.from('lab_result_uploads').update({status:'attached',matched_patient_id:patientId}).eq('id',labResultId);
  if(updateErr){ console.error('attachLabResultToPatient: status update failed',updateErr); return false; }
  return true;
}
async function dismissLabResult(labResultId){
  const {error}=await sb.from('lab_result_uploads').update({status:'dismissed'}).eq('id',labResultId);
  if(error){ console.error('dismissLabResult failed',error); return false; }
  return true;
}
// Practice-scoped filter -- see subscribePracticeSettingsRealtime()'s own
// comment above.
async function subscribeLabResultsRealtime(onChange){
  await practiceSettingsReady;
  const opts={event:'*',schema:'public',table:'lab_result_uploads'};
  const practiceId=getPracticeSettings()?.id;
  if(practiceId) opts.filter='practice_id=eq.'+practiceId;
  sb.channel('lab-result-uploads-changes')
    .on('postgres_changes',opts,function(){ if(onChange) onChange(); })
    .subscribe();
}

function genStaffInviteToken(){
  // crypto.getRandomValues instead of Math.random() -- this token grants
  // account creation to whoever holds the link, so it needs to be
  // unguessable, not just unique. 16 bytes -> 128 bits of entropy.
  const bytes=new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return 'inv_'+hex;
}
// Public lookup of a single invite by token, via a security-definer RPC so
// an anonymous visitor (not logged in yet) can validate their link without
// the whole staff_invites table being readable.
async function validateStaffInvite(token){
  const {data,error}=await sb.rpc('validate_staff_invite',{p_token:token});
  if(error||!data||!data.length) return null;
  return data[0];
}
