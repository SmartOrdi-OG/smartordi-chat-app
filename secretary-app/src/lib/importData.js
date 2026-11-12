import { sb } from './supabase';
import { createPatientAccount, updatePatientIdentity, getPlanLabelAndLimit } from './patientsData';
import { listArztStaff, createTermin } from './termineData';
import { addImpfungEntry, matchVaccineKey } from './impfungenData';
import { getImpfungenForPatient } from './vaccineSchedule';

// Mirrors secretary.html's "Patienten importieren" (CSV bulk import) --
// IMPORT_FIELDS/guessFieldForHeader()/parseCsv()/confirmImport(). Phase 20
// adds the three multi-entry "a;b;c" columns (Impfungen/Termine/
// Behandlungsverlauf), writing into patient_impfungen/termine/
// patient_visits respectively, same as the original's own
// parseImpfungenCell()/parseTermineCell()/parseVerlaufCell(). Phase 24
// adds Blutgruppe/Krankengeschichte (supabase/phase10_clinical_fields.sql's
// blutgruppe/legacy_history columns) -- both read-only everywhere else in
// secretary-app (PatientDetailModal.jsx), same as Diagnosen/Allergien:
// doctor-entered clinical data this app only ever displays, never edits.
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
  { key: 'blutgruppe', label: 'Blutgruppe' },
  { key: 'krankengeschichte', label: 'Krankengeschichte (frei, nur lesbar)' },
  { key: 'geschlecht', label: 'Geschlecht (m/w/d)' },
  { key: 'impfungen', label: 'Impfungen (Name:Datum; ...)' },
  { key: 'termine', label: 'Termine, auch vergangene (Art|Datum|Zeit|Arzt; ...)' },
  { key: 'verlauf', label: 'Behandlungsverlauf (Datum|Typ|Diagnose|Notizen; ...)' },
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
  if (h.includes('blutgruppe') || h.includes('blood')) return 'blutgruppe';
  if (h.includes('krankengeschicht') || h.includes('vorerkrankung') || h.includes('anamnese')) return 'krankengeschichte';
  if (h.includes('geschlecht') || h.includes('gender') || h.includes('sex')) return 'geschlecht';
  if (h.includes('impf') || h.includes('vaccin')) return 'impfungen';
  if (h.includes('termin')) return 'termine';
  if (h.includes('verlauf') || h.includes('behandlung')) return 'verlauf';
  return '';
}

// Each cell can list several entries, separated by ";" -- same multi-entry
// convention across all three, so a secretary preparing the export from
// the old system only has to learn one pattern.
function parseImpfungenCell(cell) {
  if (!cell) return [];
  return cell.split(';').map((s) => s.trim()).filter(Boolean).map((part) => {
    const [name, datum] = part.split(':').map((s) => s && s.trim());
    return { name: name || part, datum: normalizeDob(datum || '') };
  });
}
function parseTermineCell(cell) {
  if (!cell) return [];
  return cell.split(';').map((s) => s.trim()).filter(Boolean).map((part) => {
    const [art, datum, zeit, arzt] = part.split('|').map((s) => s && s.trim());
    return { art: art || '', datum: normalizeDob(datum || ''), zeit: zeit || '', arztName: arzt || '' };
  });
}
function parseVerlaufCell(cell) {
  if (!cell) return [];
  return cell.split(';').map((s) => s.trim()).filter(Boolean).map((part) => {
    const [datum, typ, diagnose, notes] = part.split('|').map((s) => s && s.trim());
    return { datum: normalizeDob(datum || ''), typ: typ || 'Sonstige', diagnose: diagnose || '', notes: notes || '' };
  });
}

function normalizeStaffName(s) {
  return (s || '').trim().toLowerCase().replace(/^dr\.?\s*/, '').replace(/\./g, '').replace(/\s+/g, ' ').trim();
}
// staffList: listArztStaff()'s own {id,full_name,fach} rows.
function findStaffByName(name, staffList) {
  const target = normalizeStaffName(name);
  if (!target) return null;
  return staffList.find((s) => s.full_name && normalizeStaffName(s.full_name) === target) || null;
}

async function createPatientVisit(patientId, visit, createdBy) {
  const row = {
    patient_id: patientId, visit_date: visit.date, visit_type: visit.type || null,
    diagnose: visit.diag || '', notes: visit.notes || null, created_by: createdBy || null,
  };
  const { error } = await sb.from('patient_visits').insert(row);
  if (error) { console.error('createPatientVisit failed', error); throw error; }
}

// Real appointments (createTermin()), not just text on the patient's chart
// -- an imported "kommender Termin" needs to actually show up in the
// Terminverwaltung the same way a freshly-booked one does. A past-dated row
// gets completedAt set so it's marked done rather than looking like a
// still-pending future appointment.
async function importTermineFromRow(patientId, patientName, termineList, extra, staffList) {
  let created = 0, skippedNoArzt = 0, skippedIncomplete = 0;
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const t of termineList) {
    if (!t.datum || !t.zeit) { skippedIncomplete++; continue; }
    const staff = findStaffByName(t.arztName, staffList);
    if (!staff) { skippedNoArzt++; continue; }
    try {
      const isPast = t.datum < todayStr;
      await createTermin({
        patientId, patientName, art: t.art || null, date: t.datum, time: t.zeit,
        arztId: staff.id, versicherung: extra.versicherung || null, tel: extra.tel || null,
        completedAt: isPast ? (t.datum + 'T' + t.zeit + ':00') : null,
      });
      created++;
    } catch (err) {
      console.error('Import: createTermin failed for', patientName, t, err);
      skippedIncomplete++;
    }
  }
  return { created, skippedNoArzt, skippedIncomplete };
}

// Dedups against this patient's already-recorded vaccinations (same
// vaccine name + date) -- both across repeated imports of the same old-
// system export, and against the same CSV cell malformedly listing the
// same vaccine+date twice within one run.
async function importImpfungenForPatient(patientId, impfungenList, uploadedBy) {
  let historyFailed = false;
  const already = (await getImpfungenForPatient(patientId)).map((i) => ({ vaccineName: i.vaccineName, datum: i.datum }));
  for (const entry of impfungenList) {
    if (!entry.datum) continue;
    if (already.some((a) => a.vaccineName === entry.name && a.datum === entry.datum)) continue;
    try {
      await addImpfungEntry(patientId, { vaccineKey: matchVaccineKey(entry.name), vaccineName: entry.name, datum: entry.datum }, uploadedBy);
      already.push({ vaccineName: entry.name, datum: entry.datum });
    } catch (err) {
      console.error('Import: addImpfungEntry failed for', patientId, entry, err);
      historyFailed = true;
    }
  }
  return historyFailed;
}

async function importVerlaufForPatient(patientId, verlaufList, uploadedBy) {
  let created = 0, failed = false;
  for (const entry of verlaufList) {
    if (!entry.datum) continue;
    try {
      await createPatientVisit(patientId, { date: entry.datum, type: entry.typ, diag: entry.diagnose, notes: entry.notes }, uploadedBy);
      created++;
    } catch (err) {
      console.error('Import: createPatientVisit failed for', patientId, entry, err);
      failed = true;
    }
  }
  return { created, failed };
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

const LOOKUP_COLUMNS = 'id,username,full_name,adresse,tel,email,versicherung,svnr,dob,diagnosen,allergie,geschlecht,blutgruppe,legacy_history';

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
// `uploadedBy` is the signed-in staff member's own staff_profiles(id) uuid,
// attributed on every Impfung/Verlaufseintrag this row's CSV cells create.
export async function runImport(rows, fieldIdx, fach, uploadedBy, onProgress) {
  const get = (row, key) => (fieldIdx[key] >= 0 ? (row[fieldIdx[key]] || '').trim() : '');

  const { limit } = await getPlanLabelAndLimit();
  let remainingCapacity = null;
  if (limit !== null && limit !== undefined) {
    const count = await getPatientCount();
    remainingCapacity = count === null ? null : Math.max(0, limit - count);
  }
  // Only fetched once for the whole import (same loadStaffAccounts() cache
  // idea as the original) -- every Termine cell's Arzt name is matched
  // against this same list.
  const staffList = await listArztStaff();

  const results = [];
  let skipped = 0;
  let termineCreated = 0, termineSkippedNoArzt = 0, termineSkippedIncomplete = 0, verlaufCreated = 0;
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
      blutgruppe: get(row, 'blutgruppe') || null, legacy_history: get(row, 'krankengeschichte') || null,
      geschlecht: normalizeGeschlechtText(get(row, 'geschlecht')) || null,
    };
    const impfungenList = get(row, 'impfungen') ? parseImpfungenCell(get(row, 'impfungen')) : [];
    const termineList = get(row, 'termine') ? parseTermineCell(get(row, 'termine')) : [];
    const verlaufList = get(row, 'verlauf') ? parseVerlaufCell(get(row, 'verlauf')) : [];

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
          blutgruppe: extra.blutgruppe || existing.blutgruppe || null,
          legacy_history: extra.legacy_history || existing.legacy_history || null,
          geschlecht: extra.geschlecht || existing.geschlecht || null,
        });
      } catch (err) {
        console.error('Import: update of existing patient failed for', existing.username, err);
        ok = false;
      }
      // Kept as a reference (not just pushed) so the Impfungen/Termine/
      // Verlauf sub-imports below can flag THIS row's historyFailed
      // afterward, same as the original's own resultRow pattern.
      const resultRow = { name: vorname + ' ' + nachname, username: existing.username, password: null, updated: true, syncFailed: !ok };
      results.push(resultRow);
      if (ok) {
        if (impfungenList.length && await importImpfungenForPatient(existing.id, impfungenList, uploadedBy)) resultRow.historyFailed = true;
        if (termineList.length) {
          const t = await importTermineFromRow(existing.id, vorname + ' ' + nachname, termineList, extra, staffList);
          termineCreated += t.created; termineSkippedNoArzt += t.skippedNoArzt; termineSkippedIncomplete += t.skippedIncomplete;
        }
        if (verlaufList.length) {
          const v = await importVerlaufForPatient(existing.id, verlaufList, uploadedBy);
          verlaufCreated += v.created;
          if (v.failed) resultRow.historyFailed = true;
        }
      }
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
      const { username, password, row: newRow, authPromise } = await createPatientAccount(vorname, nachname, fach, extra);
      const authOk = await authPromise;
      const resultRow = { name: vorname + ' ' + nachname, username, password, syncFailed: !authOk };
      results.push(resultRow);
      if (newRow && newRow.id) {
        if (impfungenList.length && await importImpfungenForPatient(newRow.id, impfungenList, uploadedBy)) resultRow.historyFailed = true;
        if (termineList.length) {
          const t = await importTermineFromRow(newRow.id, vorname + ' ' + nachname, termineList, extra, staffList);
          termineCreated += t.created; termineSkippedNoArzt += t.skippedNoArzt; termineSkippedIncomplete += t.skippedIncomplete;
        }
        if (verlaufList.length) {
          const v = await importVerlaufForPatient(newRow.id, verlaufList, uploadedBy);
          verlaufCreated += v.created;
          if (v.failed) resultRow.historyFailed = true;
        }
      }
    } catch (err) {
      console.error('Import: createPatientAccount failed for', vorname, nachname, err);
      results.push({ name: vorname + ' ' + nachname, username: null, password: null, syncFailed: true });
    }
  }
  return { results, skipped, termineCreated, termineSkippedNoArzt, termineSkippedIncomplete, verlaufCreated };
}

export function summarizeResults(results, skipped, planLabel, planLimit, termineStats) {
  const createdCount = results.filter((r) => !r.updated && !r.limitReached && !r.syncFailed).length;
  const updatedCount = results.filter((r) => r.updated && !r.syncFailed).length;
  const failedCount = results.filter((r) => r.syncFailed).length;
  const limitReachedCount = results.filter((r) => r.limitReached).length;
  // historyFailed: the patients row itself (and its login, for a new
  // account) saved fine, but at least one Impfung/Termin/Verlaufseintrag
  // from this same row's CSV cells failed to save -- a separate, amber
  // marker from syncFailed's red one since they mean different things and
  // need different follow-up.
  const historyFailedCount = results.filter((r) => r.historyFailed).length;
  const ts = termineStats || { termineCreated: 0, termineSkippedNoArzt: 0, termineSkippedIncomplete: 0, verlaufCreated: 0 };
  return createdCount + ' neue(r) Patient(en) angelegt.'
    + (updatedCount ? ' ' + updatedCount + ' bereits bestehende(r) Patient(en) aktualisiert (per SV-Nummer/Name+Geburtsdatum erkannt, kein neues Konto angelegt).' : '')
    + (skipped ? ' ' + skipped + ' Zeile(n) übersprungen (Vor-/Nachname fehlte).' : '')
    + (failedCount ? ' ' + failedCount + ' Zeile(n): Serverabgleich fehlgeschlagen (Internetverbindung prüfen und diese Zeile(n) erneut importieren).' : '')
    + (historyFailedCount ? ' ' + historyFailedCount + ' Zeile(n): Patient angelegt/aktualisiert, aber mind. eine Impfung/ein Termin/ein Verlaufseintrag konnte nicht gespeichert werden (Kartei manuell prüfen).' : '')
    + (limitReachedCount ? ' ' + limitReachedCount + ' Zeile(n) übersprungen: Patientenlimit des ' + planLabel + '-Pakets erreicht (' + planLimit + ' Patienten). Bitte auf Enterprise upgraden und diese Zeile(n) erneut importieren.' : '')
    + (ts.termineCreated ? ' ' + ts.termineCreated + ' Termin(e) angelegt.' : '')
    + (ts.termineSkippedNoArzt ? ' ' + ts.termineSkippedNoArzt + ' Termin(e) übersprungen (Arzt-Name nicht in der Ordination gefunden).' : '')
    + (ts.termineSkippedIncomplete ? ' ' + ts.termineSkippedIncomplete + ' Termin(e) übersprungen (Datum/Zeit fehlte oder ungültig).' : '')
    + (ts.verlaufCreated ? ' ' + ts.verlaufCreated + ' Verlaufseintrag/-einträge angelegt.' : '');
}
