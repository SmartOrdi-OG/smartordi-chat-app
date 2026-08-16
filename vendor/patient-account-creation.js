// Patient account creation + duplicate-matching, shared between secretary.html
// (the "+ Neuer Patient" flow and CSV import) and doctor.html (the
// Normdatensatz/ENDS import, see vendor/migration-normdatensatz.js). Moved out
// of secretary.html unchanged so both pages create/match patient accounts
// through the exact same, already-battle-tested logic instead of two copies
// that could silently drift apart -- this code generates real login
// credentials and writes real patient rows, so a duplicated, out-of-sync copy
// would be a correctness/security risk, not just a maintenance one.
//
// Depends on: vendor/staff-accounts.js (loadStaffAccounts), vendor/
// patient-data.js (loadPatients, loadGuardians, insertNewPatientIdentity,
// ensurePatientAuthUser, PATIENTS_COLUMNS, patientRowToJs, localPatientAccountsRaw),
// and the page's own global `sb` (Supabase client). Load this file after both
// of those vendor scripts.

const PATIENT_ACCOUNTS_KEY='smartordi_patient_accounts';

function loadPatientAccounts(){
  try{ return JSON.parse(localStorage.getItem(PATIENT_ACCOUNTS_KEY))||{}; }catch(e){ return {}; }
}
function savePatientAccounts(accounts){
  localStorage.setItem(PATIENT_ACCOUNTS_KEY, JSON.stringify(accounts));
}
function slugifyName(s){
  return (s||'').trim().toLowerCase()
    .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
    .replace(/[^a-z0-9]+/g,'');
}
function generateTempPassword(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const rnd=new Uint32Array(8);
  crypto.getRandomValues(rnd);
  let out='';
  for(let i=0;i<8;i++) out+=chars[rnd[i]%chars.length];
  return out;
}
// localStorage.fachrichtung is a single device-wide flag, manually set from
// doctor.html's Einstellungen tab (or at registration) -- it has no link to
// any specific doctor account and easily goes stale (e.g. left over from
// testing a different specialty), which previously meant a patient's QR
// credential/Anamnese could silently embed a completely wrong specialty
// (a real incident: a male patient whose actual doctors are both
// Allgemeinmedizin got shown the Gynäkologie & Geburtshilfe questionnaire).
// doctor.html's own Einstellungen display already prefers the logged-in
// doctor's real staff_profiles.fach for this same reason -- do the same
// here for new patients, using the practice admin's real fach instead.
function practiceAdminFach(){
  const accounts=loadStaffAccounts();
  const admin=Object.values(accounts).find(a=>a.role==='arzt'&&a.isAdmin);
  return (admin&&admin.fach)||'Allgemeinmedizin';
}
function createPatientAccount(vorname,nachname,extra){
  const accounts=loadPatientAccounts();
  // loadPatients() (vendor/patient-data.js) is the Supabase-backed merged
  // cache of every REAL patient, not just ones THIS browser/device has ever
  // locally seen. Without checking it too, a large CSV import (or just a
  // second device, or a patient this device never rendered yet) could
  // regenerate a username already taken by a patient this device doesn't
  // know about -- and upsertPatientIdentity()'s onConflict:'username' would
  // then silently overwrite that unrelated real patient's row instead of
  // creating a new one.
  const remoteAccounts=loadPatients();
  // supabase/phase28_guardian_child_accounts.sql -- patient_guardians is a
  // separate table/username namespace of its own now, so a generated
  // patient username also has to dodge any real guardian's username.
  const remoteGuardians=loadGuardians();
  const base=slugifyName(vorname)+'.'+slugifyName(nachname);
  let username=base, n=2;
  while(accounts[username]||remoteAccounts[username]||remoteGuardians[username]){ username=base+n; n++; }
  const password=generateTempPassword();
  // Bundled into the QR link below so the patient's Anamnese form on their
  // own device shows the right specialty questions -- see practiceAdminFach()
  // for why this isn't localStorage.fachrichtung.
  const fach=practiceAdminFach();
  accounts[username]=Object.assign({ pw:password, name:vorname, fullName:vorname+' '+nachname, fach, firstLogin:true }, extra);
  savePatientAccounts(accounts);
  // Mirrors this new patient's identity/contact info into Supabase in the
  // background (not awaited -- callers use the {username,password} return
  // value immediately to render/print a QR credential, same "fire the
  // network call, don't block the synchronous UI flow" pattern already used
  // for Termin creation). temp_password is hashed server-side into pw_hash
  // by a trigger -- without it, patient_login() always finds pw_hash null
  // and silently rejects the real password, permanently stranding this
  // patient on the old fully-local (per-device-only) login/booking/chat
  // path with no visible error.
  // identityPromise is also returned (not just fired-and-forgotten) so a
  // caller that specifically needs the real Supabase patient id -- e.g. CSV
  // import inserting historical Impfungen rows below -- can await it without
  // forcing the normal "+ Neuer Patient" QR flow to block on the network.
  //
  // authPromise is a SEPARATE promise resolving true/false once the actual
  // login (create-patient-auth-user) settles -- deliberately not folded
  // into identityPromise's own timing, so ordinary callers (the "+ Neuer
  // Patient" QR flow) keep getting their QR the moment the `patients` row
  // exists, same as before this existed. Only added because CSV import
  // (confirmImport()) needs a real signal for its own summary: previously
  // a row could show as fully successful in the import results even when
  // ensurePatientAuthUser() silently failed in the background, leaving that
  // patient with a `patients` row but no way to actually log in.
  let resolveAuthPromise;
  const authPromise=new Promise(function(res){ resolveAuthPromise=res; });
  // insertNewPatientIdentity() (not upsertPatientIdentity()): this username
  // was only just generated above and checked against loadPatients()'s
  // bounded 500-cache -- if it turns out to collide with a real patient
  // outside that cache, a plain upsert would silently overwrite their
  // record. A real INSERT fails loudly instead (see its own comment).
  const identityPromise=insertNewPatientIdentity(username,{
    name:vorname, full_name:vorname+' '+nachname, fach,
    adresse:(extra&&extra.adresse)||null, tel:(extra&&extra.tel)||null, email:(extra&&extra.email)||null,
    versicherung:(extra&&extra.versicherung)||null, svnr:(extra&&extra.svnr)||null, dob:(extra&&extra.dob)||null,
    // supabase/phase10_clinical_fields.sql -- previously only written to this
    // account's local record (see the module comment at the top of
    // vendor/patient-data.js), so a diagnosis/allergy set here (or via CSV
    // import) never reached any other staff device.
    diagnosen:(extra&&extra.diagnosen)||null, allergie:(extra&&extra.allergie)||null,
    blutgruppe:(extra&&extra.blutgruppe)||null, legacy_history:(extra&&extra.legacyHistory)||null,
    // supabase/phase65_patient_username_change_and_is_child.sql -- a plain
    // classification flag only (shown in Stammdaten), NOT tied to any
    // account-creation mechanics -- a child gets an ordinary account here
    // exactly like an adult (see "+ Neuer Patient"'s own comment above).
    is_child:!!(extra&&extra.isChild),
    // supabase/phase72_patient_geschlecht.sql -- 'm'/'w'/'d', or null for
    // "keine Angabe". Never forced by this function: secretary.html's "+
    // Neuer Patient"/CSV import and doctor.html's Normdatensatz import all
    // pass whatever (possibly nothing) they themselves collected/mapped.
    geschlecht:(extra&&extra.geschlecht)||null,
    join_status:'approved', temp_password:password,
  }).then(function(result){
    if(result.collision){
      console.error('createPatientAccount: username collision on insert for',username,'-- a real patient outside loadPatients()\'s bounded cache already has this username');
      showToast('Anlegen fehlgeschlagen: Benutzername bereits vergeben. Bitte erneut versuchen.','error');
      resolveAuthPromise(false);
      return null;
    }
    const row=result.row;
    // supabase/functions/create-patient-auth-user -- provisions this
    // patient's real Supabase Auth user in the background, same "don't
    // block the QR flow" spirit as the identity insert itself.
    if(row){
      ensurePatientAuthUser('patient',row.id,{password}).then(resolveAuthPromise).catch(function(){ resolveAuthPromise(false); });
    } else {
      resolveAuthPromise(false);
    }
    return row;
  }).catch(function(err){ console.error('insertNewPatientIdentity failed for',username,err); resolveAuthPromise(false); return null; });
  return {username,password,identityPromise,authPromise};
}

// ── Duplicate matching (used by CSV import and the Normdatensatz import) ──

function normalizeDob(str){
  if(!str) return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const m=str.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
  if(m) return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
  return str;
}
// SVNr is Austria's actual unique patient identifier -- unlike a name, two
// different real people never legitimately share it. Whitespace varies a
// lot between legacy systems' exports ("1234 010190" vs "1234010190"), so
// compare it normalized rather than as a raw string.
function normalizeSvnr(s){
  return (s||'').replace(/\s+/g,'');
}
// Finds a patient ALREADY in Supabase that an import row (CSV or
// Normdatensatz) almost certainly refers to, so the caller can update that
// existing record instead of creating a duplicate account with a different
// username for the same real person. Matches on SVNr first (the
// authoritative identifier); when SVNr is missing on one/both sides (common
// for children in older systems), falls back to an exact full-name + exact
// birth-date match -- two different real people sharing both is not a
// realistic collision, unlike sharing just a name.
//
// Live per-row server query (patient search-on-demand PR5, see TODO.md)
// instead of scanning loadPatients()'s full in-memory list -- correct
// (not just faster) for a sequential import loop specifically: Postgres
// already guarantees a row committed by an EARLIER iteration of that same
// loop is visible to this SELECT once its own await has resolved, same
// read-after-write guarantee the loop already relies on for
// createPatientAccount()'s username-uniqueness check. The exact `svnr =`
// match below depends on supabase/phase37_normalize_svnr.sql already
// having run (it normalizes svnr at write time, so this normalized value
// always matches the stored one exactly).
async function findExistingPatientForImportRow(vorname,nachname,svnrRaw,dobNorm){
  const svnrNorm=normalizeSvnr(svnrRaw);
  const fullName=(vorname+' '+nachname).trim();
  if(svnrNorm){
    const {data,error}=await sb.from('patients').select(PATIENTS_COLUMNS).eq('svnr',svnrNorm).maybeSingle();
    if(error){ console.error('findExistingPatientForImportRow (svnr) failed',error); }
    else if(data) return {username:data.username,record:patientRowToJs(data,localPatientAccountsRaw())};
  }
  if(dobNorm){
    // Same birth date can legitimately match several patients (siblings,
    // unrelated same-day births) -- exact case-insensitive name compares
    // the (typically tiny) candidate set client-side, same as before.
    const {data,error}=await sb.from('patients').select(PATIENTS_COLUMNS).eq('dob',dobNorm);
    if(error){ console.error('findExistingPatientForImportRow (dob) failed',error); return null; }
    const match=(data||[]).find(p=>p.full_name&&p.full_name.trim().toLowerCase()===fullName.toLowerCase());
    if(match) return {username:match.username,record:patientRowToJs(match,localPatientAccountsRaw())};
  }
  return null;
}
