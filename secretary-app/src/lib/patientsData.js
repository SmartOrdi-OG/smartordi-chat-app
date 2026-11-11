import { sb } from './supabase';

// Mirrors vendor/patient-data.js / vendor/patient-account-creation.js's real
// (Supabase-backed) patient identity functions used by secretary.html's "+
// Neuer Patient" and "QR-Code" flows. Deliberately drops the legacy
// localStorage "patient accounts" cache those files also carry -- this is a
// brand-new app with no pre-existing local data to merge in, so every call
// here just talks to Supabase directly.

const PATIENTS_COLUMNS = 'id,username,name,full_name,fach,dob,adresse,tel,email,versicherung,svnr,is_child,geschlecht';

function patientRowToJs(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    fullName: row.full_name,
    fach: row.fach,
    dob: row.dob,
    adresse: row.adresse,
    tel: row.tel,
    email: row.email,
    versicherung: row.versicherung,
    svnr: row.svnr,
    isChild: !!row.is_child,
    geschlecht: row.geschlecht || null,
  };
}

// Live substring search against the server (name OR SV-Nummer contains the
// query, case-insensitive) -- mirrors searchPatientsServer(). join_status
// filtered server-side here (isRealSelectablePatient() filters it
// client-side in the original, after the fact -- equivalent, just one
// fewer unneeded row to ever send over the wire).
export async function searchPatients(query, limit) {
  const q = (query || '').trim();
  if (!q) return [];
  const escaped = q.replace(/[%_]/g, '\\$&');
  const { data, error } = await sb.from('patients').select(PATIENTS_COLUMNS)
    .eq('join_status', 'approved')
    .or('full_name.ilike.%' + escaped + '%,svnr.ilike.%' + escaped + '%')
    .order('full_name')
    .limit(limit || 20);
  if (error) {
    console.error('searchPatients failed', error);
    return [];
  }
  return (data || []).map(patientRowToJs);
}

// The unfiltered "Patienten" list shown with an empty search box -- mirrors
// realPatientEntries()/loadPatients()'s own bounded cache (there, ≤500
// most-recently-active; here, a plain name-ordered page of the same size).
export async function listPatients(limit) {
  const { data, error } = await sb.from('patients').select(PATIENTS_COLUMNS)
    .eq('join_status', 'approved')
    .order('full_name')
    .limit(limit || 300);
  if (error) {
    console.error('listPatients failed', error);
    return [];
  }
  return (data || []).map(patientRowToJs);
}

// Live server-side check, not a client cache -- same "a Standard-plan
// practice's 500^H^H250-patient cap must actually block creation" reasoning
// as isPatientLimitReached().
const PLAN_PATIENT_LIMITS = { standard: 250, enterprise: null, enterprise_annual: null };
const PLAN_LABELS = { standard: 'Standard', enterprise: 'Enterprise', enterprise_annual: 'Enterprise (jährlich)' };
export async function getPlanLabelAndLimit() {
  const { data } = await sb.from('practices').select('plan').limit(1).maybeSingle();
  const plan = (data && data.plan && data.plan in PLAN_PATIENT_LIMITS) ? data.plan : 'standard';
  return { plan, label: PLAN_LABELS[plan], limit: PLAN_PATIENT_LIMITS[plan] ?? 250 };
}
export async function isPatientLimitReached() {
  const { limit } = await getPlanLabelAndLimit();
  if (limit === null || limit === undefined) return false;
  const { count, error } = await sb.from('patients').select('id', { count: 'exact', head: true });
  if (error) {
    console.error('isPatientLimitReached: count query failed', error);
    return false;
  }
  return (count || 0) >= limit;
}

export function slugifyName(s) {
  return (s || '').trim().toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '');
}

export function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const rnd = new Uint32Array(8);
  crypto.getRandomValues(rnd);
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[rnd[i] % chars.length];
  return out;
}

async function usernameTaken(username) {
  const [{ data: p }, { data: g }] = await Promise.all([
    sb.from('patients').select('id').eq('username', username).maybeSingle(),
    sb.from('patient_guardians').select('id').eq('username', username).maybeSingle(),
  ]);
  return !!p || !!g;
}

// A real INSERT (not an upsert) -- the username was only just generated and
// checked above, but a genuine collision (another device winning the same
// race) must fail loudly instead of silently overwriting an unrelated real
// patient's row. Mirrors insertNewPatientIdentity().
export async function insertNewPatientIdentity(username, fields) {
  const { data, error } = await sb.from('patients').insert(Object.assign({ username }, fields)).select(PATIENTS_COLUMNS).single();
  if (error) {
    if (error.code === '23505') return { collision: true, row: null };
    console.error('insertNewPatientIdentity failed', error);
    throw error;
  }
  return { collision: false, row: patientRowToJs(data) };
}

// Real UPDATE of just the given fields on an already-existing patient --
// used by selectQrPatient()'s password-reset-via-QR path. Mirrors
// upsertPatientIdentity()'s update branch (a patient row picked from
// searchPatients() always already exists, so the insert branch never
// applies here).
export async function updatePatientIdentity(username, fields) {
  const { data, error } = await sb.from('patients').update(fields).eq('username', username).select(PATIENTS_COLUMNS).single();
  if (error) {
    console.error('updatePatientIdentity failed', error);
    throw error;
  }
  return patientRowToJs(data);
}

// supabase/functions/create-patient-auth-user -- provisions/repairs this
// patient's real Supabase Auth login. Best-effort/non-blocking, same as the
// original: a caller fires this after its own identity write already
// succeeded and doesn't need to await it to show the QR.
export async function ensurePatientAuthUser(kind, id, opts) {
  const { error } = await sb.functions.invoke('create-patient-auth-user', { body: Object.assign({ kind, id }, opts) });
  if (error) {
    console.error('ensurePatientAuthUser failed for', kind, id, error);
    return false;
  }
  return true;
}

// Mirrors createPatientAccount(): generates a unique username + temp
// password, inserts the real `patients` row, then fires the Auth
// provisioning in the background. Returns the username/password immediately
// (for the QR) plus a promise resolving the real auth-provisioning result.
export async function createPatientAccount(vorname, nachname, fach, extra) {
  const base = slugifyName(vorname) + '.' + slugifyName(nachname);
  let username = base;
  let n = 2;
  while (await usernameTaken(username)) {
    username = base + n;
    n++;
  }
  const password = generateTempPassword();
  const result = await insertNewPatientIdentity(username, {
    name: vorname,
    full_name: vorname + ' ' + nachname,
    fach,
    adresse: (extra && extra.adresse) || null,
    tel: (extra && extra.tel) || null,
    email: (extra && extra.email) || null,
    versicherung: (extra && extra.versicherung) || null,
    svnr: (extra && extra.svnr) || null,
    dob: (extra && extra.dob) || null,
    is_child: !!(extra && extra.isChild),
    geschlecht: (extra && extra.geschlecht) || null,
    join_status: 'approved',
    temp_password: password,
  });
  if (result.collision) {
    throw new Error('USERNAME_COLLISION');
  }
  const row = result.row;
  const authPromise = ensurePatientAuthUser('patient', row.id, { password });
  return { username, password, row, authPromise };
}

// "Weiteres Kind (bestehendes Kinder-Konto)" -- links a new patient row
// straight onto an already-existing children's account via the
// staff_add_linked_child RPC, no QR/scan/approval round-trip (staff already
// reviewed this in person). Mirrors confirmNewPatient()'s childMode==='existing'
// branch.
export async function createLinkedChildAccount(vorname, nachname, fach, extra, ownerPatientId) {
  const placeholderUsername = 'profil-' + crypto.randomUUID().replace(/-/g, '');
  const result = await insertNewPatientIdentity(placeholderUsername, {
    name: vorname,
    full_name: vorname + ' ' + nachname,
    fach,
    adresse: (extra && extra.adresse) || null,
    tel: (extra && extra.tel) || null,
    email: (extra && extra.email) || null,
    versicherung: (extra && extra.versicherung) || null,
    svnr: (extra && extra.svnr) || null,
    dob: (extra && extra.dob) || null,
    is_child: true,
    geschlecht: (extra && extra.geschlecht) || null,
    join_status: 'approved',
  });
  if (result.collision) throw new Error('USERNAME_COLLISION');
  const row = result.row;
  const { data: linked, error: linkErr } = await sb.rpc('staff_add_linked_child', {
    p_owner_patient_id: ownerPatientId,
    p_new_patient_id: row.id,
    p_relation: 'child',
  });
  if (linkErr || !linked) {
    console.error('staff_add_linked_child failed', linkErr);
    throw new Error('LINK_FAILED');
  }
  // Every other approved patient row gets a real (if never directly used)
  // Supabase Auth account too -- keeps that invariant intact.
  ensurePatientAuthUser('patient', row.id, { password: generateTempPassword() });
  return row;
}

// Mirrors buildPatientLoginUrl() -- the pretty /patient-login route serves
// the React patient-app, which has its own QR temp-credential first-login
// flow (App.jsx's parseUrl()/FirstLoginScreen.jsx).
const PATIENT_PORTAL_ORIGIN = 'https://chat.smartordiog.eu';
export function buildPatientLoginUrl(username, password, displayName, needsNewUsername) {
  const params = new URLSearchParams({ u: username, t: password, n: displayName });
  if (needsNewUsername) params.set('nu', '1');
  return PATIENT_PORTAL_ORIGIN + '/patient-login?' + params.toString();
}

// Mirrors the Übersicht "Patienten einladen" QR -- a general, not-patient-
// specific self-registration link for this practice.
export function buildGeneralRegisterUrl(practiceId) {
  return PATIENT_PORTAL_ORIGIN + '/patient-register' + (practiceId ? '/' + practiceId : '');
}

// Generates a fresh temp password for an EXISTING patient (creating their
// login if they never had one, resetting it if they already do) and
// returns the QR login URL for them. Mirrors selectQrPatient().
export async function regeneratePatientQrCredentials(patient) {
  const newPw = generateTempPassword();
  await updatePatientIdentity(patient.username, { temp_password: newPw, first_login: true });
  ensurePatientAuthUser('patient', patient.id, { password: newPw });
  const loginUrl = buildPatientLoginUrl(patient.username, newPw, patient.fullName || patient.name);
  return { password: newPw, loginUrl };
}

// ── CHAT (patient_messages) -- mirrors vendor/patient-data.js's
// getMessagesForPatient()/sendMessageToPatient(). dir:'in' = from the
// patient, dir:'out' = from staff. Only plain text messages are supported
// here so far -- type 'doc'/'uw' (document attachments) aren't built yet. ──
const MESSAGE_COLUMNS = 'id,patient_id,dir,type,text,created_at';

function messageRowToJs(row) {
  return {
    id: row.id,
    out: row.dir === 'out',
    text: row.text,
    time: row.created_at
      ? new Date(row.created_at).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })
      : '',
    createdAt: row.created_at,
  };
}

export async function getMessagesForPatient(patientId) {
  const { data, error } = await sb.from('patient_messages').select(MESSAGE_COLUMNS).eq('patient_id', patientId).order('created_at');
  if (error) {
    console.error('getMessagesForPatient failed', error);
    return [];
  }
  return (data || []).map(messageRowToJs);
}

// Real "Neue Patientennachrichten" (Übersicht) data -- mirrors
// uebersichtUnreadEntries()/renderUebersichtNeueNachrichten(), using
// lib/unreadTracking.js's per-device "last viewed" marker instead of the
// original's bulk 365-day _allMessagesByPatient cache (this app doesn't
// keep one). Only looks back 90 days -- a message older than that with no
// marker yet is vanishingly unlikely to matter for "what's new right now".
const UNREAD_WINDOW_DAYS = 90;
export async function fetchUnreadMessageSummaries(lastViewedFor) {
  const cutoff = new Date(Date.now() - UNREAD_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb.from('patient_messages').select('patient_id,text,created_at')
    .eq('dir', 'in').gte('created_at', cutoff).order('created_at', { ascending: false });
  if (error) {
    console.error('fetchUnreadMessageSummaries failed', error);
    return [];
  }
  const byPatient = {};
  (data || []).forEach((row) => {
    if (!byPatient[row.patient_id]) byPatient[row.patient_id] = { latest: row, unreadCount: 0 };
    if (row.created_at > lastViewedFor(row.patient_id)) byPatient[row.patient_id].unreadCount++;
  });
  const unreadIds = Object.keys(byPatient).filter((id) => byPatient[id].unreadCount > 0);
  if (!unreadIds.length) return [];
  const { data: patients, error: pErr } = await sb.from('patients').select('id,full_name').in('id', unreadIds);
  if (pErr) {
    console.error('fetchUnreadMessageSummaries: patient lookup failed', pErr);
    return [];
  }
  const nameById = {};
  (patients || []).forEach((p) => { nameById[p.id] = p.full_name; });
  return unreadIds
    .map((id) => ({
      patientId: id,
      fullName: nameById[id] || '—',
      unreadCount: byPatient[id].unreadCount,
      preview: byPatient[id].latest.text,
      time: new Date(byPatient[id].latest.created_at).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }),
      createdAt: byPatient[id].latest.created_at,
    }))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function sendMessageToPatient(patientId, text) {
  const { data, error } = await sb.from('patient_messages').insert({ patient_id: patientId, dir: 'out', type: 'text', text }).select(MESSAGE_COLUMNS).single();
  if (error) {
    console.error('sendMessageToPatient failed', error);
    throw error;
  }
  return messageRowToJs(data);
}
