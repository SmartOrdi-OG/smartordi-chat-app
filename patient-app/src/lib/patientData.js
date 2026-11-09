import { sb } from './supabase';

// Mirrors vendor/patient-portal-data.js's real (Supabase RPC) functions.
// Only the read/send paths needed for the portal's first four tabs are
// ported so far -- booking, documents, Impfpass and MKP are not yet.

function formatMsgTime(createdAt) {
  return createdAt
    ? new Date(createdAt).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })
    : '';
}

export async function patientGetMessages() {
  const { data, error } = await sb.rpc('patient_get_messages');
  if (error) {
    console.error('patientGetMessages failed', error);
    return [];
  }
  return (data || []).map((row) => ({
    dir: row.dir,
    type: row.type,
    text: row.text,
    time: formatMsgTime(row.created_at),
    createdAt: row.created_at,
  }));
}

export async function patientSendMessage(text) {
  const { data, error } = await sb.rpc('patient_send_message', { p_text: text });
  if (error) {
    console.error('patientSendMessage failed', error);
    throw error;
  }
  return data;
}

function terminRowToJs(row) {
  return {
    id: row.id,
    art: row.art,
    date: row.date,
    time: row.time,
    endTime: row.end_time,
    status: row.status,
  };
}

export async function patientGetTermine() {
  const { data, error } = await sb.rpc('patient_get_termine');
  if (error) {
    console.error('patientGetTermine failed', error);
    return [];
  }
  return (data || []).map(terminRowToJs);
}

export async function patientGetDocuments() {
  const { data, error } = await sb.rpc('patient_get_documents');
  if (error) {
    console.error('patientGetDocuments failed', error);
    return [];
  }
  return (data || []).map((row) => ({
    id: row.id, category: row.category, title: row.title, filename: row.filename,
    mimeType: row.mime_type, sizeBytes: row.size_bytes, bodyText: row.body_text, createdAt: row.created_at,
  }));
}

export async function patientGetDocumentFile(docId) {
  const { data, error } = await sb.rpc('patient_get_document_file', { p_doc_id: docId });
  if (error) {
    console.error('patientGetDocumentFile failed', error);
    return null;
  }
  const row = data && data[0];
  if (!row) return null;
  return { filename: row.filename, mimeType: row.mime_type, base64: row.file_data };
}

export async function patientGetImpfungen() {
  const { data, error } = await sb.rpc('patient_get_impfungen');
  if (error) {
    console.error('patientGetImpfungen failed', error);
    return [];
  }
  return (data || []).map((row) => ({
    id: row.id, vaccineName: row.vaccine_name, doseLabel: row.dose_label,
    datum: row.datum, nextDue: row.next_due,
  }));
}

export async function patientGetWorkingHours() {
  const { data, error } = await sb.rpc('patient_get_working_hours');
  if (error) {
    console.error('patientGetWorkingHours failed', error);
    return null;
  }
  return data || null;
}

export async function patientGetBookingEnabled() {
  const { data, error } = await sb.rpc('patient_get_booking_enabled');
  if (error) {
    console.error('patientGetBookingEnabled failed', error);
    return true;
  }
  return data !== false;
}

export async function patientGetArztRoster() {
  const { data, error } = await sb.rpc('patient_get_staff_roster');
  if (error) {
    console.error('patientGetArztRoster failed', error);
    return [];
  }
  return (data || [])
    .filter((p) => p.role === 'arzt')
    .map((p) => ({ username: p.id, fullName: p.full_name, fach: p.fach }));
}

export async function patientGetMkpExams() {
  const { data, error } = await sb.rpc('patient_get_mkp_exams');
  if (error) {
    console.error('patientGetMkpExams failed', error);
    return [];
  }
  return (data || []).map((row) => ({
    examKey: row.exam_key, data: row.data || {}, completedAt: row.completed_at,
  }));
}

export async function patientGetProfiles() {
  const { data, error } = await sb.rpc('patient_get_profiles');
  if (error) {
    console.error('patientGetProfiles failed', error);
    return [];
  }
  return (data || []).map((r) => ({
    patientId: r.patient_id, fullName: r.full_name, relation: r.relation,
    relationLabel: r.relation_label, practiceId: r.practice_id,
    practiceName: r.practice_name, isActive: r.is_active,
  }));
}

export async function patientSwitchProfile(patientId) {
  const { data, error } = await sb.rpc('patient_switch_profile', { p_patient_id: patientId });
  if (error) {
    console.error('patientSwitchProfile failed', error);
    return false;
  }
  return !!data;
}

// Mirrors patient.html's "+ Profil hinzufügen" modal -- lets an already
// logged-in account request a new linked profile (a child, or another
// adult like a father/mother) on the SAME practice as its active profile.
// Goes through the same staff review as a brand-new registration
// (patient_join_requests), just carrying which login it should attach to
// once approved.
export async function patientSubmitProfileJoinRequest(fields, practiceId, relation, relationLabel) {
  const { data, error } = await sb.rpc('patient_submit_profile_join_request', {
    p_practice_id: practiceId, p_vorname: fields.vorname, p_nachname: fields.nachname,
    p_adresse: fields.adresse, p_svnr: fields.svnr, p_relation: relation,
    p_relation_label: relationLabel || null, p_dob: fields.dob || null,
    p_versicherung: fields.versicherung || null, p_geschlecht: fields.geschlecht || null,
  });
  if (error) {
    console.error('patientSubmitProfileJoinRequest failed', error);
    throw error;
  }
  return data;
}

export async function patientBookTermin(fields) {
  const { data, error } = await sb.rpc('patient_book_termin', {
    p_arzt_id: fields.arztUsername, p_date: fields.date,
    p_time: fields.time, p_end_time: fields.endTime, p_art: fields.art,
  });
  if (error) {
    console.error('patientBookTermin failed', error);
    throw error;
  }
  return terminRowToJs(data);
}

export async function patientSetSymptoms(terminId, reason, reasonNote) {
  const { error } = await sb.rpc('patient_set_symptoms', {
    p_termin_id: terminId, p_reason: reason, p_reason_note: reasonNote,
  });
  if (error) {
    console.error('patientSetSymptoms failed', error);
    return false;
  }
  return true;
}
