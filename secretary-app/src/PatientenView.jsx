import { useState } from 'react';
import { Icon } from './icons';
import NewPatientModal from './NewPatientModal';
import QrCodeModal from './QrCodeModal';
import PatientCredentialsModal from './PatientCredentialsModal';

// Phase 1: mirrors secretary.html's #view-patienten header (actions menu
// with Beitrittsanfragen/Importieren/QR-Code/Neuer Patient) and scroll
// area. Phase 2 wires up real "Neuer Patient" creation + "QR-Code" --
// Beitrittsanfragen/Importieren and the real patient list/chat are still
// not built yet.
export default function PatientenView() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [newPatientOpen, setNewPatientOpen] = useState(false);
  const [qrPickerOpen, setQrPickerOpen] = useState(false);
  const [cred, setCred] = useState(null);

  return (
    <div className="view active">
      <div className="view-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div>
            <div className="view-title">Patienten</div>
            <div className="view-sub">Stammdaten & Chat</div>
          </div>
          <button className="patient-actions-toggle" type="button" onClick={() => setMenuOpen((v) => !v)}>
            <Icon name="menu" size={15} /> Aktionen
          </button>
          <div className={`patient-actions-menu${menuOpen ? ' show' : ''}`}>
            <button className="rail-btn rail-btn-cyan" type="button">
              <span className="rail-btn-icon"><Icon name="joinRequests" /></span> Beitrittsanfragen
            </button>
            <button className="rail-btn" type="button">
              <span className="rail-btn-icon"><Icon name="importUp" /></span> Patienten importieren
            </button>
            <button className="rail-btn" type="button">
              <span className="rail-btn-icon"><Icon name="docImport" /></span> Dokumente importieren
            </button>
            <button className="rail-btn" type="button" onClick={() => { setMenuOpen(false); setQrPickerOpen(true); }}>
              <span className="rail-btn-icon"><Icon name="qr" /></span> QR-Code
            </button>
            <div className="rail-divider" />
            <button className="rail-btn rail-btn-primary" type="button" onClick={() => { setMenuOpen(false); setNewPatientOpen(true); }}>
              <span className="rail-btn-icon"><Icon name="personPlus" /></span> Neuer Patient
            </button>
          </div>
        </div>
      </div>
      <div className="scroll-content">
        <div className="empty-placeholder">Patientenliste folgt</div>
      </div>

      {newPatientOpen && (
        <NewPatientModal
          onClose={() => setNewPatientOpen(false)}
          onCreated={(c) => { setNewPatientOpen(false); setCred(c); }}
        />
      )}
      {qrPickerOpen && (
        <QrCodeModal
          onClose={() => setQrPickerOpen(false)}
          onCredentials={(c) => { setQrPickerOpen(false); setCred(c); }}
        />
      )}
      {cred && <PatientCredentialsModal cred={cred} onClose={() => setCred(null)} />}
    </div>
  );
}
