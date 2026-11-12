import { useState } from 'react';
import { resolveAttestArztInfo, buildAnwesenheitPdf, openPdfAndPrint } from './lib/attesteData';
import { showToast } from './lib/toast';

// Mirrors secretary.html's #attendanceModal/openAttendanceModal()/
// confirmPrintAttendance() -- opened from a Termin row (TermineView.jsx),
// one level up from the Atteste modals (Pflegefreistellung/
// Arbeitsunfähigkeit), which open from the chat pane instead. Von/Bis
// default to the booked slot but stay editable, since real attendance can
// differ slightly (same as the original). Always resolves the TREATING
// doctor of this specific Termin (termin.arztId) -- unlike the Atteste's
// own Arzt-picker, there's nothing to choose here.
export default function AttendanceModal({ termin, practice, onClose }) {
  const [von, setVon] = useState(termin.time || '');
  const [bis, setBis] = useState(termin.endTime || termin.time || '');
  const [busy, setBusy] = useState(false);

  async function handlePrint() {
    if (!von || !bis) { showToast('Bitte Von/Bis-Zeit angeben', 'error'); return; }
    if (bis <= von) { showToast('Bis muss nach Von liegen', 'error'); return; }
    setBusy(true);
    try {
      const arzt = await resolveAttestArztInfo(null, termin.arztId);
      const doc = buildAnwesenheitPdf(termin.patient, termin.date, von, bis, termin.art, arzt, practice && practice.adresse, practice && practice.tel);
      openPdfAndPrint(doc.output('bloburl'));
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg> Anwesenheitsbestätigung
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
            Patient: <strong>{termin.patient}</strong> · Termin: <strong>{termin.time}{termin.endTime ? '–' + termin.endTime : ''}</strong>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Tatsächliche Anwesenheit (bei Abweichung vom gebuchten Termin bitte anpassen):</div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Von</label>
              <input type="time" className="form-input" value={von} onChange={(e) => setVon(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Bis</label>
              <input type="time" className="form-input" value={bis} onChange={(e) => setBis(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" type="button" onClick={onClose}>Abbrechen</button>
          <button className="btn-confirm" type="button" disabled={busy} onClick={handlePrint}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg> Drucken
          </button>
        </div>
      </div>
    </div>
  );
}
