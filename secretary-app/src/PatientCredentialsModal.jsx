import { createPortal } from 'react-dom';

// Mirrors #patientCredentialsModal -- shown right after "+ Neuer Patient"
// creates an account, or after "QR-Code" regenerates one for an existing
// patient. `cred.showCreds` mirrors credCredentialsGrid's own visibility:
// hidden for a brand-new account (the secretary should never be shown a
// username/password she herself generated -- only the QR matters there),
// shown for an existing-patient password reset.
export default function PatientCredentialsModal({ cred, onClose }) {
  function handlePrint() {
    const printRoot = document.getElementById('printAreaPatient');
    if (!printRoot) return;
    printRoot.querySelector('.print-title').textContent = cred.name;
    printRoot.querySelector('.print-cred-user').textContent = cred.showCreds ? 'Benutzername: ' + cred.username : '';
    printRoot.querySelector('.print-cred-pass').textContent = cred.showCreds ? 'Passwort: ' + cred.password : '';
    printRoot.querySelector('.print-qr').src = cred.qrDataUrl;
    window.print();
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">Patient angelegt — Zugangsdaten</div>
          <button className="modal-close" type="button" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
            {cred.description}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <img src={cred.qrDataUrl} alt="Patienten-QR-Code" style={{ width: 180, height: 180, border: '2px solid #e2e8f0', borderRadius: 16 }} />
          </div>
          {cred.showCreds && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 6 }}>
              <div>
                <label className="form-label">Benutzername</label>
                <div style={{ background: '#EEF4FF', border: '1.5px solid #C7D7F5', borderRadius: 8, padding: '9px 12px', fontSize: 13, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>{cred.username}</div>
              </div>
              <div>
                <label className="form-label">Temporäres Passwort</label>
                <div style={{ background: '#EEF4FF', border: '1.5px solid #C7D7F5', borderRadius: 8, padding: '9px 12px', fontSize: 13, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>{cred.password}</div>
              </div>
            </div>
          )}
          <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: 10, fontSize: 11, color: '#854d0e', fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
            Dieses Passwort ist nur für die Erstanmeldung gültig — der Patient muss es beim ersten Einloggen sofort ändern.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" type="button" onClick={onClose}>Fertig</button>
          <button className="btn-confirm" type="button" onClick={handlePrint}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
            Ausdrucken
          </button>
        </div>
      </div>
      {createPortal(
        <div id="printAreaPatient">
          <img src="/logo-icon.png" alt="Logo" className="print-logo" />
          <img alt="QR Code" className="print-qr" />
          <div className="print-title" />
          <div className="print-sub">Scannen Sie diesen Code mit Ihrer Handykamera, um sich anzumelden. Sie werden gebeten, ein eigenes Passwort zu wählen.</div>
          <div className="print-cred-user" />
          <div className="print-cred-pass" />
        </div>,
        document.body,
      )}
    </div>
  );
}
