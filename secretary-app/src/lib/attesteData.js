import { jsPDF } from 'jspdf';
import { sb } from './supabase';

// Mirrors vendor/kartei-atteste.js's buildPflegefreistellungPdf()/
// buildArbeitsunfaehigkeitPdf() (same jsPDF direct-drawing T/L/R helper
// pattern) and createPatientPflegefreistellung()/
// createPatientArbeitsunfaehigkeit() (vendor/patient-data.js,
// supabase/phase51_atteste.sql). Print/download only, same as
// secretary.html's own modal -- no "Per Chat senden" here either (see that
// file's own header comment for why).

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('de-AT');
}

// Whose name/Fachrichtung/stamp/signature to print as the issuing doctor.
// `arztId` (Phase 21): the doctor explicitly picked in the modal's
// Arzt-picker, shown whenever listArztStaff() finds more than one --
// takes priority when given. Without it: when the signed-in staff member
// IS a doctor, that's simply their own staff_profiles row; a secretary
// has no such row of their own, so for them (or when a practice turns out
// to have only one `arzt` and the picker was never shown) this falls back
// to the first role==='arzt' account found. That fallback alone, with no
// way for the secretary to choose, was the original's own documented
// limitation -- the picker above is what actually fixes it.
export async function resolveAttestArztInfo(currentProfile, arztId) {
  const cols = 'id,full_name,fach,stempel_data_url,sig_data_url';
  if (arztId) {
    const { data } = await sb.from('staff_profiles').select(cols).eq('id', arztId).maybeSingle();
    if (data) return rowToArzt(data);
  }
  if (currentProfile && currentProfile.role === 'arzt') {
    const { data } = await sb.from('staff_profiles').select(cols).eq('id', currentProfile.id).maybeSingle();
    if (data) return rowToArzt(data);
  }
  const { data } = await sb.from('staff_profiles').select(cols).eq('role', 'arzt').limit(1).maybeSingle();
  return data ? rowToArzt(data) : null;
}
function rowToArzt(row) {
  return { fullName: row.full_name, fach: row.fach, stempelDataUrl: row.stempel_data_url || '', sigDataUrl: row.sig_data_url || '' };
}

export async function fetchPracticeAdresse() {
  const { data } = await sb.from('practices').select('adresse').limit(1).maybeSingle();
  return (data && data.adresse) || '';
}

function fmtDateLong(iso) {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('de-AT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtDateShort(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('de-AT');
}

function drawHelpers(doc) {
  // align (7th arg, optional): jsPDF's own text-alignment option -- used to
  // center the issuing doctor's name/date directly under the signature
  // image instead of left-aligning it at the image's left edge.
  const T = (text, x, y, size = 10, style = 'normal', color = [0, 0, 0], align) => {
    doc.setFontSize(size); doc.setFont('helvetica', style); doc.setTextColor(...color);
    doc.text(String(text || ''), x, y, align ? { align } : undefined);
  };
  const L = (x1, y1, x2, y2, w = 0.3) => { doc.setLineWidth(w); doc.line(x1, y1, x2, y2); };
  const R = (x, y, w, h, lw = 0.3) => { doc.setLineWidth(lw); doc.rect(x, y, w, h); };
  return { T, L, R };
}

export function buildPflegefreistellungPdf(patient, fields, arzt, practiceAdresse) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const { T, L, R } = drawHelpers(doc);
  const name = patient.fullName || patient.name || '?';

  let y = 15;
  T('BESTÄTIGUNG', 15, 14, 18, 'bold', [30, 64, 175]);
  T('Pflegefreistellung gemäß § 16 Urlaubsgesetz', 140, 10, 8, 'normal', [120, 120, 120]);
  T(new Date().toLocaleDateString('de-AT'), 140, 16, 9, 'normal', [120, 120, 120]);
  doc.setDrawColor(30, 64, 175); L(10, 20, 200, 20, 0.6);
  y = 28;

  R(10, y, 90, 22);
  T('Ausstellende Ärztin/Arzt:', 13, y + 6, 8, 'normal', [120, 120, 120]);
  T(arzt ? arzt.fullName : '—', 13, y + 12, 11, 'bold');
  T((arzt && arzt.fach || '—') + ' · ' + (practiceAdresse || '—'), 13, y + 18, 8);

  R(105, y, 95, 22);
  T('Zu pflegende Person:', 108, y + 6, 8, 'normal', [120, 120, 120]);
  T(name, 108, y + 12, 11, 'bold');
  T('SV-Nr: ' + (patient.svnr || '—'), 108, y + 18, 8);
  y += 30;

  T('Hiermit wird ärztlich bestätigt, dass die Pflege bzw. Betreuung der oben', 10, y + 6, 10, 'normal');
  T('genannten Person durch', 10, y + 12, 10, 'normal');
  T(fields.antragstellerName || '—', 55, y + 12, 11, 'bold');
  T('(' + (fields.verwandtschaftsverhaeltnis || '—') + ')', 10, y + 19, 9, 'normal', [100, 100, 100]);
  y += 27;
  T('im folgenden Zeitraum medizinisch erforderlich war:', 10, y, 10, 'normal');
  y += 8;

  doc.setFillColor(248, 250, 252); doc.rect(10, y, 190, 16, 'F'); R(10, y, 190, 16);
  T('Von', 15, y + 6, 8, 'normal', [120, 120, 120]); T(fmtDate(fields.von), 15, y + 13, 12, 'bold');
  T('Bis', 110, y + 6, 8, 'normal', [120, 120, 120]); T(fmtDate(fields.bis), 110, y + 13, 12, 'bold');
  y += 26;

  y = Math.max(y, 220);
  L(10, y, 200, y);
  y += 8;
  if (arzt && arzt.stempelDataUrl) { try { doc.addImage(arzt.stempelDataUrl, 'PNG', 10, y, 40, 30); } catch { /* ignore */ } }
  if (arzt && arzt.sigDataUrl) { try { doc.addImage(arzt.sigDataUrl, 'PNG', 60, y, 55, 26); } catch { /* ignore */ } }
  T('Stempel & Unterschrift', 30, y + 34, 8, 'normal', [150, 150, 150], 'center');
  T(arzt ? arzt.fullName : '—', 87.5, y + 34, 9, 'bold', [0, 0, 0], 'center');
  T((fields.ort || '—') + ', ' + new Date().toLocaleDateString('de-AT'), 87.5, y + 38, 8, 'normal', [120, 120, 120], 'center');

  doc.setFillColor(248, 250, 252); doc.rect(0, 282, 210, 15, 'F');
  T('DSGVO-konform', 10, 290, 7, 'normal', [150, 150, 150]);
  T('Datum: ' + new Date().toLocaleDateString('de-AT'), 170, 290, 7, 'normal', [150, 150, 150]);

  return doc;
}

export async function persistPflegefreistellung(patientId, fields, createdBy, documentId, arztId) {
  const row = {
    patient_id: patientId,
    antragsteller_name: fields.antragstellerName || '',
    verwandtschaftsverhaeltnis: fields.verwandtschaftsverhaeltnis || '',
    von: fields.von,
    bis: fields.bis,
    ort: fields.ort || null,
    document_id: documentId || null,
    created_by: createdBy || null,
    arzt_id: arztId || null,
  };
  const { error } = await sb.from('patient_pflegefreistellung').insert(row);
  if (error) { console.error('persistPflegefreistellung failed', error); throw error; }
}

export function buildArbeitsunfaehigkeitPdf(patient, fields, arzt) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const { T, L, R } = drawHelpers(doc);
  const name = patient.fullName || patient.name || '?';

  let y = 15;
  T('ARBEITSUNFÄHIGKEITSMELDUNG', 15, 14, 15, 'bold', [30, 64, 175]);
  T('Krankenstandsbestätigung', 140, 10, 8, 'normal', [120, 120, 120]);
  T(new Date().toLocaleDateString('de-AT'), 140, 16, 9, 'normal', [120, 120, 120]);
  doc.setDrawColor(30, 64, 175); L(10, 20, 200, 20, 0.6);
  y = 28;

  R(10, y, 90, 22);
  T('Ausstellende Ärztin/Arzt:', 13, y + 6, 8, 'normal', [120, 120, 120]);
  T(arzt ? arzt.fullName : '—', 13, y + 12, 11, 'bold');
  T(arzt && arzt.fach || '—', 13, y + 18, 8);

  R(105, y, 95, 22);
  T('Patient/in:', 108, y + 6, 8, 'normal', [120, 120, 120]);
  T(name, 108, y + 12, 11, 'bold');
  T('SV-Nr: ' + (fields.versicherungsnummer || patient.svnr || '—'), 108, y + 18, 8);
  y += 30;

  T('Zeitraum der Arbeitsunfähigkeit:', 10, y + 6, 10, 'bold');
  y += 10;
  doc.setFillColor(248, 250, 252); doc.rect(10, y, 190, 16, 'F'); R(10, y, 190, 16);
  T('Von', 15, y + 6, 8, 'normal', [120, 120, 120]); T(fmtDate(fields.von), 15, y + 13, 12, 'bold');
  T('Bis', 110, y + 6, 8, 'normal', [120, 120, 120]); T(fmtDate(fields.bis), 110, y + 13, 12, 'bold');
  y += 24;

  R(10, y, 190, 16);
  T('Grund', 15, y + 6, 8, 'normal', [120, 120, 120]); T(fields.grund || 'Krankheit', 15, y + 13, 11, 'bold');
  T('Bettruhe', 110, y + 6, 8, 'normal', [120, 120, 120]);
  T(fields.bettruhe ? 'erforderlich' : 'nicht erforderlich', 110, y + 13, 10, 'bold', fields.bettruhe ? [220, 38, 38] : [22, 163, 74]);
  y += 22;

  if (fields.ausgehzeitVon || fields.ausgehzeitBis) {
    R(10, y, 190, 14);
    T('Ausgehzeiten', 15, y + 6, 8, 'normal', [120, 120, 120]);
    T((fields.ausgehzeitVon || '—') + ' – ' + (fields.ausgehzeitBis || '—') + ' Uhr', 15, y + 12, 10, 'bold');
    y += 20;
  }

  R(10, y, 190, 16);
  T('Krankenstandsadresse', 15, y + 6, 8, 'normal', [120, 120, 120]);
  T(fields.krankenstandsadresse || '—', 15, y + 13, 10);
  y += 22;

  R(10, y, 190, 14);
  T('Versicherungsträger', 15, y + 6, 8, 'normal', [120, 120, 120]);
  T(fields.versicherungstraeger || '—', 15, y + 12, 10, 'bold');
  y += 20;

  y = Math.max(y, 225);
  L(10, y, 200, y);
  y += 8;
  if (arzt && arzt.stempelDataUrl) { try { doc.addImage(arzt.stempelDataUrl, 'PNG', 10, y, 40, 30); } catch { /* ignore */ } }
  if (arzt && arzt.sigDataUrl) { try { doc.addImage(arzt.sigDataUrl, 'PNG', 60, y, 55, 26); } catch { /* ignore */ } }
  T('Stempel & Unterschrift', 30, y + 34, 8, 'normal', [150, 150, 150], 'center');
  T(arzt ? arzt.fullName : '—', 87.5, y + 34, 9, 'bold', [0, 0, 0], 'center');

  doc.setFillColor(248, 250, 252); doc.rect(0, 282, 210, 15, 'F');
  T('DSGVO-konform', 10, 290, 7, 'normal', [150, 150, 150]);
  T('Datum: ' + new Date().toLocaleDateString('de-AT'), 170, 290, 7, 'normal', [150, 150, 150]);

  return doc;
}

export async function persistArbeitsunfaehigkeit(patientId, fields, createdBy, documentId, arztId) {
  const row = {
    patient_id: patientId,
    krankenstandsadresse: fields.krankenstandsadresse || null,
    von: fields.von,
    bis: fields.bis,
    ausgehzeit_von: fields.ausgehzeitVon || null,
    ausgehzeit_bis: fields.ausgehzeitBis || null,
    bettruhe: !!fields.bettruhe,
    grund: fields.grund || 'Krankheit',
    versicherungstraeger: fields.versicherungstraeger || null,
    versicherungsnummer: fields.versicherungsnummer || null,
    document_id: documentId || null,
    created_by: createdBy || null,
    arzt_id: arztId || null,
  };
  const { error } = await sb.from('patient_arbeitsunfaehigkeit').insert(row);
  if (error) { console.error('persistArbeitsunfaehigkeit failed', error); throw error; }
}

// Mirrors secretary.html's printTerminSlip() -- a small pre-visit slip
// handed to the patient at the desk (as opposed to buildAnwesenheitPdf()
// below, the A4 post-visit proof-of-attendance). The original writes a
// whole separate HTML document via document.write() and needed its own
// escapeHtml() pass to stay safe from injection through that second
// surface (found in a 2026-07-29 security audit) -- jsPDF draws text
// directly with no HTML/DOM step at all, so that whole class of risk
// doesn't exist here to begin with.
export function buildTerminSlipPdf(patientName, date, time, endTime, art, praxisName, praxisAdresse, praxisTel) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [90, 120] });
  const { T, L, R } = drawHelpers(doc);
  const name = patientName || '?';
  const timeRange = time + (endTime ? '–' + endTime : '');

  let y = 10;
  T('Termininformation', 6, y, 12, 'bold');
  T('ausgestellt am: ' + new Date().toLocaleDateString('de-AT'), 84, y - 3, 7, 'normal', [100, 100, 100], 'right');
  T('für: ' + name, 84, y + 2, 7, 'normal', [100, 100, 100], 'right');
  y += 8;
  doc.setDrawColor(0, 0, 0); L(6, y, 84, y, 0.3);
  y += 6;

  T('Folgender Termin wurde für ' + name + ' vorgemerkt:', 6, y, 9);
  y += 6;

  R(6, y, 78, 16);
  T('Datum / Zeit', 8, y + 5, 8, 'bold');
  T('Info', 50, y + 5, 8, 'bold');
  L(48, y, 48, y + 16, 0.2);
  T(fmtDateShort(date) + ', ' + timeRange + ' Uhr', 8, y + 12, 8);
  T(art || '', 50, y + 12, 8);
  y += 24;

  T('Ordination ' + (praxisName || '—') + ' · ' + (praxisAdresse || '—'), 6, y, 7, 'normal', [80, 80, 80]);
  y += 4;
  T('Tel.: ' + (praxisTel || '—'), 6, y, 7, 'normal', [80, 80, 80]);
  y += 4;
  T('Bitte bringen Sie Ihre e-card mit. Bei Verhinderung bitte 24h vorher absagen.', 6, y, 7, 'normal', [80, 80, 80]);

  return doc;
}

// Mirrors secretary.html's printAnwesenheitsbestaetigung() -- an A4
// proof-of-attendance for the patient's employer/school/insurer, with the
// actually-TREATING doctor's own saved stamp/signature (same
// staff_profiles.sig_data_url/stempel_data_url the Atteste above use),
// never the secretary's own (secretaries don't have one).
export function buildAnwesenheitPdf(patientName, date, von, bis, art, arzt, praxisAdresse, praxisTel) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const { T, L } = drawHelpers(doc);
  const name = patientName || '?';

  let y = 24;
  T('ANWESENHEITSBESTÄTIGUNG', 105, y, 16, 'bold', [0, 0, 0], 'center');
  y += 16;
  T('Hiermit wird bestätigt, dass', 20, y, 11);
  y += 12;

  doc.setFillColor(234, 244, 241); doc.roundedRect(20, y, 170, 42, 3, 3, 'F');
  const row = (label, value, ry) => {
    T(label, 26, ry, 9, 'normal', [100, 116, 139]);
    T(value, 184, ry, 10, 'bold', [0, 0, 0], 'right');
  };
  row('Patient/in', name, y + 9);
  row('Datum', fmtDateLong(date), y + 18);
  row('Anwesenheit', von + '–' + bis + ' Uhr', y + 27);
  row('Art des Termins', art || '—', y + 36);
  y += 42;
  // Dynamic 5th row (Behandelnde/r Arzt/Ärztin) -- kept separate since the
  // box above was already sized for exactly 4 rows at the original's own
  // line-height; this one line is appended right after it instead of
  // resizing the shared box.
  T('Behandelnde/r Arzt/Ärztin', 26, y + 7, 9, 'normal', [100, 116, 139]);
  T(arzt ? arzt.fullName : '—', 184, y + 7, 10, 'bold', [0, 0, 0], 'right');
  y += 16;

  T('sich am oben genannten Datum in der angegebenen Zeit in unserer Ordination', 20, y, 11);
  y += 7;
  T('befunden hat.', 20, y, 11);

  y = 230;
  if (arzt && arzt.stempelDataUrl) { try { doc.addImage(arzt.stempelDataUrl, 'PNG', 140, y - 20, 36, 26); } catch { /* ignore */ } }
  if (arzt && arzt.sigDataUrl) { try { doc.addImage(arzt.sigDataUrl, 'PNG', 130, y, 56, 22); } catch { /* ignore */ } }
  L(130, y + 24, 186, y + 24, 0.3);
  T('Unterschrift / Stempel', 158, y + 29, 8, 'normal', [100, 116, 139], 'center');
  T(praxisAdresse || '—', 20, y + 20, 9, 'normal', [71, 85, 105]);
  T(praxisTel || '—', 20, y + 26, 9, 'normal', [71, 85, 105]);

  T('Ausgestellt am ' + new Date().toLocaleDateString('de-AT') + ' · DSGVO-konform', 105, 275, 7, 'normal', [148, 163, 184], 'center');

  return doc;
}

// doctor.html/secretary.html both use a hidden-iframe print (no visible
// print dialog flash of a whole extra tab) -- mirrors window.openPdfAndPrint().
export function openPdfAndPrint(blobUrl) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-10000px;left:-10000px;width:1px;height:1px;border:0;';
  iframe.src = blobUrl;
  document.body.appendChild(iframe);
  const cleanup = () => iframe.remove();
  iframe.onload = () => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
    catch { cleanup(); window.open(blobUrl); }
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(cleanup, 120000);
}
