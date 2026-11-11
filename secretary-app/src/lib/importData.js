import { sb } from './supabase';
import { createPatientAccount, updatePatientIdentity, getPlanLabelAndLimit } from './patientsData';

// Mirrors secretary.html's "Patienten importieren" (CSV bulk import) --
// IMPORT_FIELDS/guessFieldForHeader()/parseCsv()/confirmImport(). Narrower
// scope than the original: only the plain identity/contact fields are
// imported here. Impfungen/Termine/Behandlungsverlauf (each its own
// multi-entry "a;b;c" cell format, each writing into a subsystem --
// patient_impfungen, termine, patient_visits -- this app doesn't have a
// full UI for yet) and the free-text Krankengeschichte notes column aren't
// supported in this phase.
export const IMPORT_FIELDS = [
  { key: 'vorname', label: 'Vorname' },
  { key: 'nachname', label: 'Nachname' },
  { key: 'dob', label: 'Geburtsdatum' },
  { key: 'svnr', label: 'SV-Nummer' },
  { key: 'versicherung', label: 'Versicherung' },
  { key: 'tel', label: 'Telefon' },
  { key: 'email', label: 'E-Mail' },
  { key: 'adresse', label: 'Adresse' },
  { key: 'diagnosen', label: 'Diagnosen' },
  { key: 'allergie', label: 'Allergien' },
  { key: 'geschlecht', label: 'Geschlecht (m/w/d)' },
  { key: '', label: 'Ignorieren' },
];

export function guessFieldForHeader(header) {
  const h = (header || '').toLowerCase();
  if (h.includes('vorname')) return 'vorname';
  if (h.includes('nachname') || h.includes('familienname')) return 'nachname';
  if (h.includes('geburt')) return 'dob';
  if (h.includes('sv') && (h.includes('nr') || h.includes('nummer'))) return 'svnr';
  if (h.includes('versicherung') || h.includes('kasse')) return 'versicherung';
  if (h.includes('tel') || h.includes('mobil') || h.includes('phone')) return 'tel';
  if (h.includes('mail')) return 'email';
  if (h.includes('adresse') || h.includes('address') || h.includes('strass') || h.includes('straß')) return 'adresse';
  if (h.includes('diagnos')) return 'diagnosen';
  if (h.includes('allerg')) return 'allergie';
  if (h.includes('geschlecht') || h.includes('gender') || h.includes('sex')) return 'geschlecht';
  return '';
}

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length);
  if (!lines.length) return { headers: [], rows: [] };
  const splitLine = (l) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    out.push(cur.trim());
    return out;
  };
  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map(splitLine);
  return { headers, rows };
}

export function normalizeDob(str) {
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const m = str.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return str;
}
export function normalizeSvnr(s) {
  return (s || '').replace(/\s+/g, '');
}

const GESCHLECHT_SYNONYMS = {
  m: 'm', male: 'm', mann: 'm', männlich: 'm', maennlich: 'm',
  w: 'w', f: 'w', female: 'w', frau: 'w', weiblich: 'w',
  d: 'd', x: 'd', divers: 'd', undifferentiated: 'd', un: 'd', other: 'd', andere: 'd',
};
function normalizeGeschlechtText(raw) {
  const key = (raw || '').trim().toLowerCase();
  if (!key) return undefined;
  return GESCHLECHT_SYNONYMS[key];
}

const LOOKUP_COLUMNS = 'id,username,full_name,adresse,tel,email,versicherung,svnr,dob,diagnosen,allergie,geschlecht';

// Finds a patient ALREADY in Supabase that this import row almost certainly
// refers to (by SVNr, the authoritative identifier; falling back to exact
// full-name + exact birth-date when SVNr is missing) -- mirrors
// findExistingPatientForImportRow().
async function findExistingPatientForImportRow(vorname, nachname, svnrRaw, dobNorm) {
  const svnrNorm = normalizeSvnr(svnrRaw);
  const fullName = (vorname + ' ' + nachname).trim();
  if (svnrNorm) {
    const { data, error } = await sb.from('patients').select(LOOKUP_COLUMNS).eq('svnr', svnrNorm).maybeSingle();
    if (error) console.error('findExistingPatientForImportRow (svnr) failed', error);
    else if (data) return data;
  }
  if (dobNorm) {
    const { data, error } = await sb.from('patients').select(LOOKUP_COLUMNS).eq('dob', dobNorm);
    if (error) { console.error('findExistingPatientForImportRow (dob) failed', error); return null; }
    const match = (data || []).find((p) => p.full_name && p.full_name.trim().toLowerCase() === fullName.toLowerCase());
    if (match) return match;
  }
  return null;
}

async function getPatientCount() {
  const { count, error } = await sb.from('patients').select('id', { count: 'exact', head: true });
  if (error) { console.error('getPatientCount failed', error); return null; }
  return count || 0;
}

// Imports every row sequentially (not in parallel) -- createPatientAccount()'s
// username-uniqueness check only sees an earlier row's write once it has
// actually committed, same reasoning as the original's own sequential loop.
// `onProgress(i, total)` lets the modal show live progress on a long import.
export async function runImport(rows, fieldIdx, fach, onProgress) {
  const get = (row, key) => (fieldIdx[key] >= 0 ? (row[fieldIdx[key]] || '').trim() : '');

  const { limit } = await getPlanLabelAndLimit();
  let remainingCapacity = null;
  if (limit !== null && limit !== undefined) {
    const count = await getPatientCount();
    remainingCapacity = count === null ? null : Math.max(0, limit - count);
  }

  const results = [];
  let skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    if (onProgress) onProgress(i + 1, rows.length);
    const row = rows[i];
    const vorname = get(row, 'vorname');
    const nachname = get(row, 'nachname');
    if (!vorname || !nachname) { skipped++; continue; }
    const svnrRaw = get(row, 'svnr');
    const dobNorm = normalizeDob(get(row, 'dob'));
    const extra = {
      adresse: get(row, 'adresse') || null, dob: dobNorm || null, versicherung: get(row, 'versicherung') || null,
      svnr: svnrRaw || null, tel: get(row, 'tel') || null, email: get(row, 'email') || null,
      diagnosen: get(row, 'diagnosen') || null, allergie: get(row, 'allergie') || null,
      geschlecht: normalizeGeschlechtText(get(row, 'geschlecht')) || null,
    };

    // Already a real patient (matched by SVNr, or by exact name+birth-date)
    // -- update their existing record instead of creating a second account.
    // Deliberately never touches temp_password/pw_hash/join_status: this
    // patient may already be using their existing login.
    const existing = await findExistingPatientForImportRow(vorname, nachname, svnrRaw, dobNorm);
    if (existing) {
      let ok = true;
      try {
        await updatePatientIdentity(existing.username, {
          name: vorname, full_name: vorname + ' ' + nachname,
          adresse: extra.adresse || existing.adresse || null,
          tel: extra.tel || existing.tel || null,
          email: extra.email || existing.email || null,
          versicherung: extra.versicherung || existing.versicherung || null,
          svnr: extra.svnr || existing.svnr || null,
          dob: extra.dob || existing.dob || null,
          diagnosen: extra.diagnosen || existing.diagnosen || null,
          allergie: extra.allergie || existing.allergie || null,
          geschlecht: extra.geschlecht || existing.geschlecht || null,
        });
      } catch (err) {
        console.error('Import: update of existing patient failed for', existing.username, err);
        ok = false;
      }
      results.push({ name: vorname + ' ' + nachname, username: existing.username, password: null, updated: true, syncFailed: !ok });
      continue;
    }

    if (remainingCapacity !== null) {
      if (remainingCapacity <= 0) {
        results.push({ name: vorname + ' ' + nachname, username: null, password: null, limitReached: true });
        continue;
      }
      remainingCapacity--;
    }
    try {
      const { username, password, authPromise } = await createPatientAccount(vorname, nachname, fach, extra);
      const authOk = await authPromise;
      results.push({ name: vorname + ' ' + nachname, username, password, syncFailed: !authOk });
    } catch (err) {
      console.error('Import: createPatientAccount failed for', vorname, nachname, err);
      results.push({ name: vorname + ' ' + nachname, username: null, password: null, syncFailed: true });
    }
  }
  return { results, skipped };
}

export function summarizeResults(results, skipped, planLabel, planLimit) {
  const createdCount = results.filter((r) => !r.updated && !r.limitReached && !r.syncFailed).length;
  const updatedCount = results.filter((r) => r.updated && !r.syncFailed).length;
  const failedCount = results.filter((r) => r.syncFailed).length;
  const limitReachedCount = results.filter((r) => r.limitReached).length;
  return createdCount + ' neue(r) Patient(en) angelegt.'
    + (updatedCount ? ' ' + updatedCount + ' bereits bestehende(r) Patient(en) aktualisiert (per SV-Nummer/Name+Geburtsdatum erkannt, kein neues Konto angelegt).' : '')
    + (skipped ? ' ' + skipped + ' Zeile(n) übersprungen (Vor-/Nachname fehlte).' : '')
    + (failedCount ? ' ' + failedCount + ' Zeile(n): Serverabgleich fehlgeschlagen (Internetverbindung prüfen und diese Zeile(n) erneut importieren).' : '')
    + (limitReachedCount ? ' ' + limitReachedCount + ' Zeile(n) übersprungen: Patientenlimit des ' + planLabel + '-Pakets erreicht (' + planLimit + ' Patienten). Bitte auf Enterprise upgraden und diese Zeile(n) erneut importieren.' : '');
}
