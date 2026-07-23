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

// Shared bookable-appointment-slot grid (08:00-11:30, 14:00-16:00, 15-minute
// steps) -- both the patient-facing self-booking picker (patient.html) and
// staff's own booking forms (secretary.html) generate their slot list from
// this single source instead of three separately hand-typed option lists,
// which had drifted inconsistent with each other (different intervals,
// missing slots) before this existed.
function buildTimeSlots(fromH,fromM,toH,toM,fromH2,fromM2,toH2,toM2){
  const slots=[];
  const push=(fromH,fromM,toH,toM)=>{
    let h=fromH,m=fromM;
    while(h<toH||(h===toH&&m<=toM)){
      slots.push(String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'));
      m+=15; if(m>=60){m=0;h++;}
    }
  };
  push(fromH,fromM,toH,toM);
  push(fromH2,fromM2,toH2,toM2);
  return slots;
}
const PRACTICE_TIME_SLOTS=buildTimeSlots(8,0,11,30, 14,0,16,0);
// "Bis" (end-time) selects need to offer something *after* the last bookable
// start of each block -- otherwise picking that last start (11:30 or 16:00)
// leaves no valid end option nearby, and syncEndTimeAfterStart's "first
// option greater than start" search jumps all the way to the next block
// (e.g. a 11:30 start defaulting its end to 14:00, spanning the whole lunch
// break) instead of a sensible ~15-30 minutes later.
const PRACTICE_TIME_SLOTS_END=buildTimeSlots(8,0,12,0, 14,0,16,30);
function timeSlotOptionsHtml(){
  return PRACTICE_TIME_SLOTS.map(s=>`<option>${s}</option>`).join('');
}
function timeSlotEndOptionsHtml(){
  return PRACTICE_TIME_SLOTS_END.map(s=>`<option>${s}</option>`).join('');
}

// In-memory cache of every staff_profiles row, keyed by uuid -- refreshed
// once (awaited) during each page's init so the many existing synchronous
// call sites (arztAccounts, arztDisplayName, renderTeamCard...) don't all
// need to become async themselves.
let _staffRoster={};
async function refreshStaffRoster(){
  const {data,error}=await sb.from('staff_profiles').select('*');
  if(error){ console.error('refreshStaffRoster failed',error); return; }
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
  if(error){ console.error('refreshPracticeSettings failed',error); return; }
  _practiceSettings=data||null;
}
function getPracticeSettings(){
  return _practiceSettings;
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
  await uploadPatientDocument(patientId,{
    category:'labor', title:row.subject||'Laborbefund', filename:row.filename,
    mimeType:row.mime_type, base64Data:row.file_data,
  },uploadedBy);
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
