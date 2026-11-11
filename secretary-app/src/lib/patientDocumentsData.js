import { sb } from './supabase';

// Mirrors doctor.html's Kartei "Dokumente" tab (vendor/kartei-documents.js)
// -- renderKarteiDocuments()/downloadKarteiDocument()/deleteKarteiDocument()/
// uploadKarteiDocument(). secretary.html itself has no such tab of its own
// (its only document touchpoint is downloading a PDF a chat "uw" message
// already links to), so this is a new, disclosed addition to secretary-app
// rather than a straight port -- it's the natural place to review/manage
// everything Phase 10's CSV import and Phase 12's Atteste already wrote
// into patient_documents, and to upload one-off files by hand. The Labor
// "quick note" (body_text, no file) path stays doctor-only -- not built
// here, just rendered read-only if one happens to already exist.
export const DOCUMENT_CATEGORIES = [
  { key: 'befund', label: 'Befund' },
  { key: 'ueberweisung', label: 'Überweisung' },
  { key: 'rezept', label: 'Rezept' },
  { key: 'sonstiges', label: 'Sonstiges' },
];
export const DOCUMENT_CATEGORY_LABEL = Object.fromEntries(DOCUMENT_CATEGORIES.map((c) => [c.key, c.label]));

export function formatFileSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const COLUMNS = 'id,category,title,filename,mime_type,size_bytes,body_text,created_at';

export async function getDocumentsForPatient(patientId) {
  const { data, error } = await sb.from('patient_documents').select(COLUMNS).eq('patient_id', patientId).order('created_at', { ascending: false });
  if (error) { console.error('getDocumentsForPatient failed', error); return []; }
  return data || [];
}

export async function getPatientDocumentFile(docId) {
  const { data, error } = await sb.from('patient_documents').select('filename,mime_type,file_data').eq('id', docId).maybeSingle();
  if (error) { console.error('getPatientDocumentFile failed', error); return null; }
  if (!data) return null;
  return { filename: data.filename, mimeType: data.mime_type, base64: data.file_data };
}

export async function uploadPatientDocument(patientId, doc, uploadedBy) {
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

export async function deletePatientDocument(docId) {
  const { error } = await sb.from('patient_documents').delete().eq('id', docId);
  if (error) { console.error('deletePatientDocument failed', error); throw error; }
}

// FileReader wrapped as a Promise -- mirrors doctor.html's fileToBase64().
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Browser download of a base64 file -- mirrors downloadKarteiDocument().
export async function triggerFileDownload(filename, mimeType, base64) {
  const blob = await (await fetch('data:' + mimeType + ';base64,' + base64)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
