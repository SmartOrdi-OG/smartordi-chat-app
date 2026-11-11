import { useState } from 'react';
import {
  buildArbeitsunfaehigkeitPdf, persistArbeitsunfaehigkeit, openPdfAndPrint, resolveAttestArztInfo,
} from './lib/attesteData';

// Mirrors secretary.html's #arbeitsunfaehigkeitModal.
export default function ArbeitsunfaehigkeitModal({ patient, profile, onClose }) {
  const [von, setVon] = useState('');
  const [bis, setBis] = useState('');
  const [grund, setGrund] = useState('Krankheit');
  const [adresse, setAdresse] = useState(patient.adresse || '');
  const [bettruhe, setBettruhe] = useState(false);
  const [ausgehVon, setAusgehVon] = useState('');
  const [ausgehBis, setAusgehBis] = useState('');
  const [versTraeger, setVersTraeger] = useState(patient.versicherung || '');
  const [versNummer, setVersNummer] = useState(patient.svnr || '');
  const [busy, setBusy] = useState(false);

  async function buildAndPersist() {
    const arzt = await resolveAttestArztInfo(profile);
    const fields = {
      von, bis, grund, krankenstandsadresse: adresse, bettruhe,
      ausgehzeitVon: ausgehVon, ausgehzeitBis: ausgehBis,
      versicherungstraeger: versTraeger, versicherungsnummer: versNummer,
    };
    const doc = buildArbeitsunfaehigkeitPdf(patient, fields, arzt);
    try { await persistArbeitsunfaehigkeit(patient.id, fields, profile?.fullName || null, null); }
    catch (err) { console.error('Failed to persist structured Arbeitsunfähigkeit record', err); }
    return doc;
  }

  async function handleDownload() {
    setBusy(true);
    try {
      const doc = await buildAndPersist();
      doc.save('Arbeitsunfaehigkeit_' + (patient.fullName || patient.name || '').replace(/\s+/g, '_') + '.pdf');
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
          <div className="modal-title">Arbeitsunfähigkeitsmeldung</div>
          <button className="modal-close" type="button" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <div className="form-label">Patient/in</div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 12px', fontSize: 13, color: '#0f172a', fontWeight: 600 }}>
              {patient.fullName || patient.name}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="form-group">
              <label className="form-label">Arbeitsunfähig von</label>
              <input type="date" className="form-input" value={von} onChange={(e) => setVon(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">bis</label>
              <input type="date" className="form-input" value={bis} onChange={(e) => setBis(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Grund</label>
            <input type="text" className="form-input" value={grund} onChange={(e) => setGrund(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Krankenstandsadresse</label>
            <input type="text" className="form-input" placeholder="Adresse während des Krankenstands" value={adresse} onChange={(e) => setAdresse(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: 12 }}>
            <input type="checkbox" id="au-bettruhe" style={{ width: 18, height: 18, accentColor: '#0E5E56' }} checked={bettruhe} onChange={(e) => setBettruhe(e.target.checked)} />
            <label htmlFor="au-bettruhe" style={{ fontSize: 13, fontWeight: 600, color: '#15803d', cursor: 'pointer' }}>Bettruhe erforderlich</label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="form-group">
              <label className="form-label">Ausgehzeit von (falls erlaubt)</label>
              <input type="text" className="form-input" placeholder="z.B. 10:00" value={ausgehVon} onChange={(e) => setAusgehVon(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">bis</label>
              <input type="text" className="form-input" placeholder="z.B. 12:00" value={ausgehBis} onChange={(e) => setAusgehBis(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="form-group">
              <label className="form-label">Versicherungsträger</label>
              <input type="text" className="form-input" value={versTraeger} onChange={(e) => setVersTraeger(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Versicherungsnummer</label>
              <input type="text" className="form-input" value={versNummer} onChange={(e) => setVersNummer(e.target.value)} />
            </div>
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
