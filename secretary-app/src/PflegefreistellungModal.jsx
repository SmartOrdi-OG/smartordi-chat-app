import { useEffect, useState } from 'react';
import {
  buildPflegefreistellungPdf, persistPflegefreistellung, openPdfAndPrint,
  resolveAttestArztInfo, fetchPracticeAdresse,
} from './lib/attesteData';
import { listArztStaff } from './lib/termineData';

// Mirrors secretary.html's #pflegefreistellungModal -- opened from the chat
// pane's "Aktionen" menu for whichever patient's chat is currently open.
// Field IDs there match doctor.html's own Kartei tab; here they're just
// plain component state instead. Phase 21 adds the Arzt-picker (only shown
// once listArztStaff() comes back with more than one doctor) -- the
// original always just picked "the first arzt found" with no way for the
// secretary to choose, which resolveAttestArztInfo() still falls back to
// here whenever there's only one doctor or the picker hasn't loaded yet.
export default function PflegefreistellungModal({ patient, profile, onClose }) {
  const [antragsteller, setAntragsteller] = useState('');
  const [verwandtschaft, setVerwandtschaft] = useState('');
  const [von, setVon] = useState('');
  const [bis, setBis] = useState('');
  const [ort, setOrt] = useState('');
  const [busy, setBusy] = useState(false);
  const [arztList, setArztList] = useState([]);
  const [arztId, setArztId] = useState(profile?.role === 'arzt' ? profile.id : '');

  useEffect(() => {
    listArztStaff().then((list) => {
      setArztList(list);
      setArztId((cur) => cur || (list[0] && list[0].id) || '');
    });
  }, []);

  async function buildAndPersist() {
    const [arzt, practiceAdresse] = await Promise.all([resolveAttestArztInfo(profile, arztId), fetchPracticeAdresse()]);
    const fields = { antragstellerName: antragsteller, verwandtschaftsverhaeltnis: verwandtschaft, von, bis, ort };
    const doc = buildPflegefreistellungPdf(patient, fields, arzt, practiceAdresse);
    try { await persistPflegefreistellung(patient.id, fields, profile?.fullName || null, null, arztId); }
    catch (err) { console.error('Failed to persist structured Pflegefreistellung record', err); }
    return doc;
  }

  async function handleDownload() {
    setBusy(true);
    try {
      const doc = await buildAndPersist();
      doc.save('Pflegefreistellung_' + (patient.fullName || patient.name || '').replace(/\s+/g, '_') + '.pdf');
    } finally { setBusy(false); }
  }
  async function handlePrint() {
    setBusy(true);
    try {
      const doc = await buildAndPersist();
      openPdfAndPrint(doc.output('bloburl'));
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">Bestätigung: Pflegefreistellung</div>
          <button className="modal-close" type="button" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <div className="form-label">Zu pflegende Person (Patient/in)</div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 12px', fontSize: 13, color: '#0f172a', fontWeight: 600 }}>
              {patient.fullName || patient.name}
            </div>
          </div>
          {arztList.length > 1 && (
            <div className="form-group">
              <label className="form-label">Ausstellende Ärztin/Arzt</label>
              <select className="form-input" value={arztId} onChange={(e) => setArztId(e.target.value)}>
                {arztList.map((a) => <option key={a.id} value={a.id}>{a.full_name}{a.fach ? ' · ' + a.fach : ''}</option>)}
              </select>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Antragsteller/in (pflegende, berufstätige Person)</label>
            <input type="text" className="form-input" placeholder="Vor- und Nachname" value={antragsteller} onChange={(e) => setAntragsteller(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Verwandtschaftsverhältnis zum/zur Patient/in</label>
            <input type="text" className="form-input" placeholder="z.B. Mutter, Vater, Ehepartner/in" value={verwandtschaft} onChange={(e) => setVerwandtschaft(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="form-group">
              <label className="form-label">Pflege erforderlich von</label>
              <input type="date" className="form-input" value={von} onChange={(e) => setVon(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">bis</label>
              <input type="date" className="form-input" value={bis} onChange={(e) => setBis(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Ausstellungsort</label>
            <input type="text" className="form-input" placeholder="z.B. Linz" value={ort} onChange={(e) => setOrt(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" type="button" disabled={busy} onClick={handleDownload}>Herunterladen</button>
          <button className="btn-confirm" type="button" disabled={busy} onClick={handlePrint}>Drucken</button>
        </div>
      </div>
    </div>
  );
}
