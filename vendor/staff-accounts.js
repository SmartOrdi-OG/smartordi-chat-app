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

// Practice-wide settings (plan, ordination/adresse/tel, trial, payment) --
// shared by the whole team via Supabase instead of living per-device in
// localStorage, same cache-then-read-sync pattern as the staff roster above.
let _practiceSettings=null;
async function refreshPracticeSettings(){
  const {data,error}=await sb.from('practice_settings').select('*').eq('id',true).maybeSingle();
  if(error){ console.error('refreshPracticeSettings failed',error); return; }
  _practiceSettings=data||null;
}
function getPracticeSettings(){
  return _practiceSettings;
}
async function savePracticeSettings(fields){
  const existing=_practiceSettings;
  const row=Object.assign({id:true},existing,fields);
  const {data,error}=await sb.from('practice_settings').upsert(row).select().single();
  if(error){ console.error('savePracticeSettings failed',error); return false; }
  _practiceSettings=data;
  return true;
}
const practiceSettingsReady=refreshPracticeSettings();

// Real Vertretung (coverage/locum) system: a doctor's absence period, who is
// covering (a real colleague already in staff_profiles, or an external
// doctor entered as free-text contact info), and a lightweight per-patient
// handoff record (a summary snapshot, not the live patient record itself --
// patient data still lives in localStorage, not Supabase). Fetched on-demand
// when the Vertretung tab opens, not kicked off at page load like the
// roster/practice settings above, since only doctor.html needs it.
async function loadActiveCoverage(){
  const {data,error}=await sb.from('practice_coverage').select('*').eq('status','active');
  if(error){ console.error('loadActiveCoverage failed',error); return []; }
  return data||[];
}
async function createCoverage(fields){
  const {data,error}=await sb.from('practice_coverage').insert(fields).select().single();
  if(error){ console.error('createCoverage failed',error); return null; }
  return data;
}
async function cancelCoverage(id){
  const {error}=await sb.from('practice_coverage').update({status:'cancelled'}).eq('id',id);
  if(error){ console.error('cancelCoverage failed',error); return false; }
  return true;
}
async function loadHandoffsForCoverage(coverageId){
  const {data,error}=await sb.from('patient_handoffs').select('*').eq('coverage_id',coverageId);
  if(error){ console.error('loadHandoffsForCoverage failed',error); return []; }
  return data||[];
}
async function createHandoff(fields){
  const {data,error}=await sb.from('patient_handoffs').insert(fields).select().single();
  if(error){ console.error('createHandoff failed',error); return null; }
  return data;
}
async function updateHandoffStatus(id,status){
  const {error}=await sb.from('patient_handoffs').update({status}).eq('id',id);
  if(error){ console.error('updateHandoffStatus failed',error); return false; }
  return true;
}

// Real patient records (Kartei/Stammdaten), replacing the per-device
// localStorage `smartordi_patient_accounts` store for everything except the
// chat message thread (still localStorage for now -- a separate, later
// migration). Patients are NOT Supabase Auth users (most have no e-mail,
// and child accounts have no login of their own at all), so every
// patient-facing read/write goes through a security-definer RPC instead of
// direct table access -- RLS on `patients` only grants `select`/`insert`/
// `update` to `authenticated` (i.e. staff), so an anonymous patient browser
// can never read the raw table, only what a passing RPC hands back.
//
// The cache below (`_patients`, keyed by username, camelCase fields matching
// the old localStorage account shape) is populated via a plain `select *`,
// which only staff pages (doctor.html/secretary.html, real Supabase Auth
// sessions) can actually see rows for -- on patient.html/patient-login.html
// (always anon) it stays empty by design, and those pages instead hold their
// own single record from the login RPC's response.
let _patients={};
async function refreshPatients(){
  const {data,error}=await sb.from('patients').select('*');
  if(error){ console.error('refreshPatients failed',error); return; }
  const byId={};
  (data||[]).forEach(p=>{ byId[p.id]=p; });
  const next={};
  (data||[]).forEach(p=>{
    next[p.username]=mapPatientRow(p,byId);
  });
  (data||[]).forEach(p=>{
    if(p.guardian_id && byId[p.guardian_id]){
      const g=next[byId[p.guardian_id].username];
      if(g){ if(!g.children) g.children=[]; g.children.push(p.username); }
    }
  });
  _patients=next;
}
function mapPatientRow(p,byId){
  const guardianRow=(p.guardian_id&&byId)?byId[p.guardian_id]:null;
  return {
    id:p.id, username:p.username,
    name:p.vorname, fullName:p.full_name, fach:p.fach,
    dob:p.dob, svnr:p.svnr, versicherung:p.versicherung, tel:p.tel, email:p.email, adresse:p.adresse,
    blutgruppe:p.blutgruppe, diagnosen:p.diagnosen, allergie:p.allergie, legacyHistory:p.legacy_history,
    impfungen:p.impfungen||[], anamnese:p.anamnese||{},
    role:p.role, isChild:p.is_child, guardianUsername:guardianRow?guardianRow.username:undefined,
    firstLogin:p.must_change_password,
    joinStatus:p.join_status||undefined, joinNote:p.join_note||'', joinSubmittedAt:p.join_submitted_at,
  };
}
function loadPatientAccounts(){
  return _patients;
}
const patientsReady=refreshPatients();

async function createPatient(fields){
  const {data,error}=await sb.from('patients').insert(fields).select().single();
  if(error){ console.error('createPatient failed',error); return null; }
  await refreshPatients();
  return mapPatientRow(data);
}
async function updatePatient(id,fields){
  const {error}=await sb.from('patients').update(fields).eq('id',id);
  if(error){ console.error('updatePatient failed',error); return false; }
  await refreshPatients();
  return true;
}
// Login (and QR-link login, which is the same credential pair carried in
// the URL): the only way an anon browser can ever get a patient row back.
async function authenticatePatient(username,password){
  const {data,error}=await sb.rpc('authenticate_patient',{p_username:username,p_password:password});
  if(error||!data||!data.length) return null;
  return mapPatientRow(data[0]);
}
async function setPatientPassword(username,oldPassword,newPassword){
  const {data,error}=await sb.rpc('set_patient_password',{p_username:username,p_old_password:oldPassword,p_new_password:newPassword});
  if(error) return false;
  return !!data;
}
async function submitPatientJoinRequest(fields){
  const {data,error}=await sb.rpc('submit_join_request',{
    p_username:fields.username, p_password:fields.password, p_vorname:fields.vorname, p_nachname:fields.nachname,
    p_adresse:fields.adresse, p_svnr:fields.svnr, p_fach:fields.fach,
  });
  if(error) return false;
  return !!data;
}
// patient.html (always anon, see the note above) re-verifies the guardian's
// own password here too, exactly like authenticatePatient -- otherwise
// anyone who guessed a guardian's username could read their children's
// medical records with zero authentication.
async function getPatientChildren(username,password){
  const {data,error}=await sb.rpc('get_my_children',{p_username:username,p_password:password});
  if(error||!data) return [];
  return data.map(p=>mapPatientRow(p));
}

function genStaffInviteToken(){
  return 'inv_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
}
// Public lookup of a single invite by token, via a security-definer RPC so
// an anonymous visitor (not logged in yet) can validate their link without
// the whole staff_invites table being readable.
async function validateStaffInvite(token){
  const {data,error}=await sb.rpc('validate_staff_invite',{p_token:token});
  if(error||!data||!data.length) return null;
  return data[0];
}
