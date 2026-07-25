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

// Persists a doctor's own signature/stamp (supabase/phase23_staff_
// signature_stamp.sql) -- staffId is always the CALLER's own id in every
// real call site (doctor.html only ever saves its own logged-in doctor's
// signature), never another staff member's.
async function saveStaffSignature(staffId,fields){
  const {data,error}=await sb.from('staff_profiles').update(fields).eq('id',staffId).select().single();
  if(error){ console.error('saveStaffSignature failed',error); return false; }
  if(_staffRoster[staffId]){
    _staffRoster[staffId].stempelDataUrl=data.stempel_data_url||'';
    _staffRoster[staffId].sigDataUrl=data.sig_data_url||'';
  }
  return true;
}
// Persists the doctor's own name/Fachrichtung from Einstellungen
// (staff_profiles.full_name/fach) -- the settings form used to only update
// the on-screen name and a localStorage shadow copy, so the edit silently
// reverted to the old server value on reload or from any other device.
async function saveStaffProfileFields(staffId,fields){
  const {data,error}=await sb.from('staff_profiles').update(fields).eq('id',staffId).select().single();
  if(error){ console.error('saveStaffProfileFields failed',error); return false; }
  if(_staffRoster[staffId]){
    _staffRoster[staffId].fullName=data.full_name;
    _staffRoster[staffId].fach=data.fach;
  }
  return true;
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
// Staff-side accessor for the practice's own configured Öffnungszeiten --
// patient.html can't use this (no direct table access under RLS), it fetches
// the same data via patient_get_working_hours() instead (vendor/patient-
// portal-data.js) and falls back to this same DEFAULT_WORKING_HOURS itself.
function getWorkingHours(){
  return (_practiceSettings&&_practiceSettings.working_hours)||DEFAULT_WORKING_HOURS;
}
async function savePracticeSettings(fields){
  if(!_practiceSettings||!_practiceSettings.id){ console.error('savePracticeSettings called before practice settings loaded'); return false; }
  const {data,error}=await sb.from('practices').update(fields).eq('id',_practiceSettings.id).select().single();
  if(error){ console.error('savePracticeSettings failed',error); return false; }
  _practiceSettings=data;
  return true;
}
const practiceSettingsReady=refreshPracticeSettings();

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
function subscribeLabResultsRealtime(onChange){
  sb.channel('lab-result-uploads-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'lab_result_uploads'},function(){ if(onChange) onChange(); })
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
