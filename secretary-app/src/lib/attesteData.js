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
// When the signed-in staff member IS a doctor, that's simply their own
// staff_profiles row. A secretary has no such row of their own -- for them,
// issuing staff is always "the practice's doctor" (falls back to the first
// role==='arzt' account found; a practice with more than one doctor would
// need the secretary to pick one explicitly, not yet supported -- same
// limitation the original documents).
export async function resolveAttestArztInfo(currentProfile) {
  const cols = 'id,full_name,fach,stempel_data_url,sig_data_url';
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

export async function persistPflegefreistellung(patientId, fields, createdBy, documentId) {
  const row = {
    patient_id: patientId,
    antragsteller_name: fields.antragstellerName || '',
    verwandtschaftsverhaeltnis: fields.verwandtschaftsverhaeltnis || '',
    von: fields.von,
    bis: fields.bis,
    ort: fields.ort || null,
    document_id: documentId || null,
    created_by: createdBy || null,
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

export async function persistArbeitsunfaehigkeit(patientId, fields, createdBy, documentId) {
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
  };
  const { error } = await sb.from('patient_arbeitsunfaehigkeit').insert(row);
  if (error) { console.error('persistArbeitsunfaehigkeit failed', error); throw error; }
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
