import JSZip from 'jszip';
import { sb } from './supabase';
import { normalizeDob, normalizeSvnr } from './importData';
import { getPlanUploadMaxBytes } from './patientsData';

// Mirrors secretary.html's "Dokumente importieren" (ZIP + manifest CSV ->
// patient_documents) -- DOC_IMPORT_FIELDS/guessFieldForDocHeader()/
// loadZipFileEntries()/findPatientForDocRow()/confirmDocImport(). Distinct
// from lib/importData.js's patient CSV import: this never creates a patient
// account, it only attaches files to patients that already exist.
export const DOC_IMPORT_FIELDS = [
  { key: 'filename', label: 'Dateiname (im ZIP)' },
  { key: 'svnr', label: 'SV-Nummer' },
  { key: 'vorname', label: 'Vorname' },
  { key: 'nachname', label: 'Nachname' },
  { key: 'dob', label: 'Geburtsdatum (bei Namensgleichheit)' },
  { key: 'title', label: 'Titel' },
  { key: 'category', label: 'Kategorie (befund/ueberweisung/rezept/sonstiges)' },
  { key: '', label: 'Ignorieren' },
];

export function guessFieldForDocHeader(header) {
  const h = (header || '').toLowerCase();
  if (h.includes('datei') || h.includes('file')) return 'filename';
  if (h.includes('sv') && (h.includes('nr') || h.includes('nummer'))) return 'svnr';
  if (h.includes('vorname')) return 'vorname';
  if (h.includes('nachname') || h.includes('familienname')) return 'nachname';
  if (h.includes('geburt')) return 'dob';
  if (h.includes('titel') || h.includes('title')) return 'title';
  if (h.includes('kategorie') || h.includes('category')) return 'category';
  return '';
}

// Reads the uploaded ZIP via JSZip and builds a lookup keyed by BOTH each
// entry's full path and its bare filename -- a manifest written by hand
// usually only lists "befund.pdf", not "old-export/2019/befund.pdf".
export async function loadZipFileEntries(zipFile) {
  const buf = await zipFile.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const lookup = {};
  Object.keys(zip.files).forEach((path) => {
    const entry = zip.files[path];
    if (entry.dir) return;
    lookup[path] = entry;
    const basename = path.split('/').pop();
    if (!(basename in lookup)) lookup[basename] = entry;
  });
  return lookup;
}

const DOCS_COLUMNS = 'id,username,full_name,dob';

// An ambiguous name match (more than one same-named patient) is only
// resolved if the manifest ALSO supplies a Geburtsdatum narrowing it down to
// exactly one -- otherwise treated as "not found" (safe, forces a human to
// double-check) rather than guessing and attaching a document to the wrong
// person's chart.
async function findPatientForDocRow(svnrRaw, vorname, nachname, dobNorm) {
  const svnrNorm = normalizeSvnr(svnrRaw);
  const fullName = ((vorname || '') + ' ' + (nachname || '')).trim();
  if (svnrNorm) {
    const { data, error } = await sb.from('patients').select(DOCS_COLUMNS).eq('svnr', svnrNorm).maybeSingle();
    if (error) console.error('findPatientForDocRow (svnr) failed', error);
    else if (data) return data;
  }
  if (!fullName) return null;
  const { data, error } = await sb.from('patients').select(DOCS_COLUMNS).ilike('full_name', fullName);
  if (error) { console.error('findPatientForDocRow (name) failed', error); return null; }
  let matches = data || [];
  if (matches.length > 1 && dobNorm) matches = matches.filter((p) => p.dob === dobNorm);
  return matches.length === 1 ? matches[0] : null;
}

const DOC_MIME_BY_EXT = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
function guessMimeFromFilename(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  return DOC_MIME_BY_EXT[ext] || null;
}

const DOC_CATEGORIES = ['befund', 'ueberweisung', 'rezept', 'sonstiges'];

async function uploadPatientDocument(patientId, doc, uploadedBy) {
  const row = {
    patient_id: patientId,
    category: doc.category || 'sonstiges',
    title: doc.title,
    filename: doc.filename || null,
    mime_type: doc.mimeType || null,
    size_bytes: doc.sizeBytes || null,
    file_data: doc.base64Data || null,
    uploaded_by: uploadedBy || null,
  };
  const { error } = await sb.from('patient_documents').insert(row);
  if (error) { console.error('uploadPatientDocument failed', error); throw error; }
}

// Sequential, same reasoning as lib/importData.js's runImport(): no username
// race here, but keeping one file's read/upload fully awaited before
// starting the next keeps memory use bounded (a ZIP full of several-MB
// PDFs held as base64 all at once would otherwise multiply badly) and
// keeps the live "Importiere X von Y" progress line accurate.
export async function runDocImport(rows, fieldIdx, zipEntries, onProgress) {
  const get = (row, key) => (fieldIdx[key] >= 0 ? (row[fieldIdx[key]] || '').trim() : '');
  const maxBytes = await getPlanUploadMaxBytes();
  const { data: userData } = await sb.auth.getUser();
  const uploadedBy = (userData && userData.user && userData.user.id) || null;

  const results = [];
  for (let i = 0; i < rows.length; i++) {
    if (onProgress) onProgress(i + 1, rows.length);
    const row = rows[i];
    const filename = get(row, 'filename');
    if (!filename) { results.push({ filename: '—', patient: '—', status: 'Kein Dateiname angegeben', ok: false }); continue; }
    const entry = zipEntries ? zipEntries[filename] : null;
    if (!entry) { results.push({ filename, patient: '—', status: 'Datei nicht im ZIP gefunden', ok: false }); continue; }
    const svnrRaw = get(row, 'svnr');
    const vorname = get(row, 'vorname');
    const nachname = get(row, 'nachname');
    const dobNorm = normalizeDob(get(row, 'dob'));
    const found = await findPatientForDocRow(svnrRaw, vorname, nachname, dobNorm);
    if (!found) { results.push({ filename, patient: (vorname + ' ' + nachname).trim() || svnrRaw || '—', status: 'Kein passender Patient gefunden', ok: false }); continue; }
    const mimeType = guessMimeFromFilename(filename);
    if (!mimeType) { results.push({ filename, patient: found.full_name, status: 'Dateityp nicht erlaubt (nur PDF/PNG/JPG)', ok: false }); continue; }
    let base64;
    try { base64 = await entry.async('base64'); }
    catch (err) { console.error('Doc import: reading ZIP entry failed for', filename, err); results.push({ filename, patient: found.full_name, status: 'Datei konnte nicht gelesen werden', ok: false }); continue; }
    const sizeBytes = Math.ceil(base64.length * 3 / 4);
    if (sizeBytes > maxBytes) { results.push({ filename, patient: found.full_name, status: 'Datei zu groß (max. ' + Math.round(maxBytes / (1024 * 1024)) + ' MB)', ok: false }); continue; }
    const categoryRaw = get(row, 'category');
    const category = DOC_CATEGORIES.includes(categoryRaw) ? categoryRaw : 'sonstiges';
    const title = get(row, 'title') || filename;
    try {
      await uploadPatientDocument(found.id, { category, title, filename, mimeType, sizeBytes, base64Data: base64 }, uploadedBy);
      results.push({ filename, patient: found.full_name, status: 'Hochgeladen', ok: true });
    } catch (err) {
      console.error('Doc import: uploadPatientDocument failed for', filename, err);
      results.push({ filename, patient: found.full_name, status: 'Hochladen fehlgeschlagen', ok: false });
    }
  }
  return results;
}

export function summarizeDocResults(results) {
  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  return okCount + ' Dokument(e) erfolgreich hochgeladen.' + (failCount ? ' ' + failCount + ' Zeile(n) fehlgeschlagen (siehe Tabelle).' : '');
}
