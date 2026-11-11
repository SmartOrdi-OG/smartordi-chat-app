import { useRef, useState } from 'react';
import { searchPatients, regeneratePatientQrCredentials } from './lib/patientsData';
import { renderQrDataUrl } from './lib/qr';
import { showToast } from './lib/toast';
import PatientSearchResults from './PatientSearchResults';

// Mirrors secretary.html's "☰ Aktionen" -> "QR-Code" patient picker +
// selectQrPatient() -- picks any existing patient and issues a fresh login
// QR for them (creates their login if they never had one, resets their
// password if they already do).
export default function QrCodeModal({ onClose, onCredentials }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const timer = useRef(null);

  function onSearch(value) {
    setQuery(value);
    clearTimeout(timer.current);
    const q = value.trim();
    if (!q) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setResults(await searchPatients(q, 20));
    }, 250);
  }

  async function handleSelect(patient) {
    try {
      const { password, loginUrl } = await regeneratePatientQrCredentials(patient);
      onCredentials({
        name: patient.fullName || patient.name,
        username: patient.username,
        password,
        qrDataUrl: renderQrDataUrl(loginUrl),
        showCreds: true,
        description: 'Für ' + (patient.fullName || patient.name) + ' wurde ein Zugang erstellt. Drucken Sie diesen QR-Code aus und geben Sie ihn dem Patienten — er scannt ihn mit der Handykamera, wird automatisch angemeldet und muss nur noch ein eigenes Passwort wählen.',
      });
    } catch (err) {
      console.error('regeneratePatientQrCredentials failed', err);
      showToast('QR-Code konnte nicht erstellt werden', 'error');
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <div className="modal-title">QR-Code für Patient</div>
          <button className="modal-close" type="button" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="patient-search" style={{ marginBottom: 10 }}>
            <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg></span>
            <input type="text" placeholder="Name oder SV-Nummer suchen..." autoFocus value={query} onChange={(e) => onSearch(e.target.value)} />
          </div>
          {query.trim() !== '' && <PatientSearchResults results={results} onSelect={handleSelect} />}
        </div>
      </div>
    </div>
  );
}
