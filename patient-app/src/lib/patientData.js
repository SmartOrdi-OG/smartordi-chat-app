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
