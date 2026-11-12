import { sb } from './supabase';

// Mirrors vendor/patient-data.js's loadTermine()/insertTermin()/updateTermin()
// -- simplified to fetch one day at a time (live, not a standing in-memory
// cache of a rolling window) since this app's Termine view only ever shows
// one day's agenda so far, not the original's month-grid calendar.

const TERMINE_COLUMNS = 'id,patient_id,patient_name,art,date,time,end_time,status,arzt_id,versicherung,tel,completed_at,created_at';

function terminRowToJs(row) {
  return {
    id: row.id,
    patientId: row.patient_id,
    patient: row.patient_name,
    art: row.art,
    date: row.date,
    time: row.time,
    endTime: row.end_time,
    status: row.status,
    arztId: row.arzt_id,
    versicherung: row.versicherung,
    tel: row.tel,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export async function listTermineForDate(date) {
  const { data, error } = await sb.from('termine').select(TERMINE_COLUMNS).eq('date', date).order('time');
  if (error) {
    console.error('listTermineForDate failed', error);
    return [];
  }
  return (data || []).map(terminRowToJs);
}

export async function listArztStaff() {
  const { data, error } = await sb.from('staff_profiles').select('id,full_name,fach').eq('role', 'arzt');
  if (error) {
    console.error('listArztStaff failed', error);
    return [];
  }
  return data || [];
}

// status:'bestaetigt' -- mirrors createTermin() (secretary.html): a Termin
// booked directly by staff has no one else who needs to review/approve it,
// so it's created already confirmed, unlike a patient's own self-booked
// request (patient_book_termin), which lands in 'neu' to wait for staff.
// completedAt (Phase 20): set only by the CSV import's own Termine column
// for a past-dated row -- marks a historical appointment carried over from
// an old system as already done, same as the original's own
// importTermineFromRow().
export async function createTermin(fields) {
  const row = {
    patient_id: fields.patientId || null,
    patient_name: fields.patientName,
    art: fields.art || null,
    date: fields.date,
    time: fields.time,
    end_time: fields.endTime || null,
    status: 'bestaetigt',
    arzt_id: fields.arztId || null,
    versicherung: fields.versicherung || null,
    tel: fields.tel || null,
    completed_at: fields.completedAt || null,
  };
  const { data, error } = await sb.from('termine').insert(row).select(TERMINE_COLUMNS).single();
  if (error) {
    console.error('createTermin failed', error);
    throw error;
  }
  return terminRowToJs(data);
}

export async function updateTerminStatus(id, status) {
  const { data, error } = await sb.from('termine').update({ status }).eq('id', id).select(TERMINE_COLUMNS).maybeSingle();
  if (error || !data) {
    console.error('updateTerminStatus failed', error);
    return null;
  }
  return terminRowToJs(data);
}

export async function moveTermin(id, { date, time, endTime }) {
  const patch = { time, end_time: endTime };
  if (date) patch.date = date;
  const { data, error } = await sb.from('termine').update(patch).eq('id', id).select(TERMINE_COLUMNS).maybeSingle();
  if (error || !data) {
    console.error('moveTermin failed', error);
    return null;
  }
  return terminRowToJs(data);
}

export function longDateDE(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Mirrors secretary.html's sendTerminConfirmationMessage()/
// sendTerminMoveMessage()/sendTerminCancelMessage() -- `text` is the
// German-rendered fallback (what staff themselves see here, and what any
// OLDER message sent before Phase 22 still has); `msgKey`/`msgParams`
// (supabase/phase83_patient_message_translations.sql -- already applied on
// the real project, same columns the original already writes) let the
// patient's own app re-render this in whatever language they've chosen,
// via vendor/i18n-patient.js's trParams(), once patient-app itself grows
// that rendering (it doesn't yet -- today it just shows this same `text`,
// same as before Phase 22; this only makes the data forward-compatible).
// msgParams carries raw facts only (a resolved doctor display name, the
// already-computed time range, the Art text, and the Termin's own ISO
// date left unformatted so a translated render can apply its own
// locale's date format) -- never a pre-built German sentence fragment.
export function buildTerminConfirmedText(t, arztName) {
  const timeRange = t.time + (t.endTime ? '–' + t.endTime : '');
  const arztPart = arztName ? ' bei ' + arztName : '';
  return {
    text: `✓ Ihr Termin${arztPart} wurde bestätigt: ${longDateDE(t.date)}, ${timeRange} Uhr${t.art ? ' · ' + t.art : ''}.`,
    msgKey: 'chat.system.terminConfirmed',
    msgParams: { doctor: arztName || null, date: t.date, time: timeRange, art: t.art || null },
  };
}
export function buildTerminMovedText(t, arztName) {
  const timeRange = t.time + (t.endTime ? '–' + t.endTime : '');
  const arztPart = arztName ? ' bei ' + arztName : '';
  return {
    text: `↕ Ihr Termin${arztPart} wurde verschoben: neu am ${longDateDE(t.date)}, ${timeRange} Uhr${t.art ? ' · ' + t.art : ''}.`,
    msgKey: 'chat.system.terminMoved',
    msgParams: { doctor: arztName || null, date: t.date, time: timeRange, art: t.art || null },
  };
}
export function buildTerminCancelledText(t) {
  const timeRange = t.time + (t.endTime ? '–' + t.endTime : '');
  return {
    text: `✗ Ihr Termin am ${longDateDE(t.date)}, ${timeRange} Uhr wurde abgesagt. Bitte vereinbaren Sie bei Bedarf einen neuen Termin.`,
    msgKey: 'chat.system.terminCancelled',
    msgParams: { date: t.date, time: timeRange },
  };
}

function timeRangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Live, date-scoped conflict check (mirrors findTermineConflict()) -- same
// patient or same Arzt already booked overlapping this exact date/time.
export async function findTerminConflict({ date, time, endTime, arztId, patientName, excludeId }) {
  const dayTermine = (await listTermineForDate(date)).filter((t) => t.status !== 'abgesagt' && t.id !== excludeId);
  const et = endTime || time;
  const active = dayTermine.filter((t) => timeRangesOverlap(time, et, t.time, t.endTime || t.time));
  if (arztId && active.some((t) => t.arztId === arztId)) return 'arzt';
  if (patientName && active.some((t) => t.patient === patientName)) return 'patient';
  return null;
}

// Busy [start,end) ranges for one doctor on one date -- mirrors
// busyRangesForDoctor(), the basis for filtering the "+ Neuer Termin"
// slot dropdowns so an already-booked start isn't even offered.
export async function busyRangesForArzt(date, arztId, excludeId) {
  if (!date || !arztId) return [];
  const dayTermine = await listTermineForDate(date);
  return dayTermine
    .filter((t) => t.arztId === arztId && t.status !== 'abgesagt' && t.id !== excludeId)
    .map((t) => ({ start: t.time, end: t.endTime || t.time }));
}
