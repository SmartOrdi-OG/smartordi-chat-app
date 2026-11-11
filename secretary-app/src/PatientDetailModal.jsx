import { useEffect, useState } from 'react';
import { updatePatientIdentity, ensurePatientAuthUser, generateTempPassword, requestPatientDeletion } from './lib/patientsData';
import { fetchPracticeSettings } from './lib/staffAuth';
import { svnrMatchesDob } from './lib/svnr';
import { showToast } from './lib/toast';
import NewTerminModal from './NewTerminModal';

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// Mirrors secretary.html's #patientDetailModal ("Bearbeiten") +
// savePatientEdit()/resetPatientPassword()/requestPatientDeletion(). Phase
// 15 adds the DSGVO "Datenlöschung beantragen" (Art. 17 GDPR) section --
// all of its legal/retention logic (10-year § 51 ÄrzteG statutory
// retention, immediate anonymization vs. scheduling the exact legal date)
// lives server-side in the already-reviewed request_patient_deletion RPC
// (supabase/phase17_data_retention.sql); this only confirms, calls it, and
// relays the result. Phase 19 adds "Neuen Termin buchen" -- reuses Phase
// 5's own NewTerminModal (pre-filled via its initialPatient prop) instead
// of duplicating the original's separate inline PD_SLOT_IDS form.
export default function PatientDetailModal({ patient, onClose, onSaved }) {
  const [form, setForm] = useState({
    svnr: patient.svnr || '',
    dob: patient.dob || '',
    adresse: patient.adresse || '',
    tel: patient.tel || '',
    email: patient.email || '',
    versicherung: patient.versicherung || 'ÖGK',
    geschlecht: patient.geschlecht || '',
  });
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deletionResult, setDeletionResult] = useState(null);
  const [newTerminOpen, setNewTerminOpen] = useState(false);
  const [practice, setPractice] = useState(null);

  useEffect(() => {
    fetchPracticeSettings().then(setPractice);
  }, []);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }
  const svnrWarning = svnrMatchesDob(form.svnr, form.dob) === false;
  const name = patient.fullName || patient.name;

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await updatePatientIdentity(patient.username, {
        adresse: form.adresse, tel: form.tel, email: form.email,
        versicherung: form.versicherung, svnr: form.svnr,
        dob: form.dob || null, geschlecht: form.geschlecht || null,
      });
      showToast('Stammdaten gespeichert', 'success');
      onSaved(updated);
    } catch {
      showToast('Speichern fehlgeschlagen', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword() {
    if (!window.confirm('Neues Passwort für ' + name + ' erstellen? Das alte Passwort wird sofort ungültig.')) return;
    setResetting(true);
    try {
      const pw = generateTempPassword();
      await updatePatientIdentity(patient.username, { temp_password: pw, first_login: true });
      ensurePatientAuthUser('patient', patient.id, { password: pw });
      setNewPassword(pw);
      showToast('Neues Passwort erstellt — bitte an Patient/in weitergeben', 'success');
    } catch {
      showToast('Zurücksetzen fehlgeschlagen', 'error');
    } finally {
      setResetting(false);
    }
  }

  async function handleRequestDeletion() {
    if (!window.confirm(
      'Datenlöschung für ' + name + ' beantragen? Der Portal-Zugang des Patienten wird sofort gelöscht; '
      + 'die Karteidaten bleiben bis zum Ende der gesetzlichen Aufbewahrungsfrist erhalten. '
      + 'Dies kann nicht rückgängig gemacht werden.',
    )) return;
    setDeleting(true);
    try {
      const result = await requestPatientDeletion(patient.id);
      if (!result) { showToast('Löschung fehlgeschlagen', 'error'); return; }
      if (result.anonymizedImmediately) {
        showToast('Patientendaten anonymisiert', 'success');
        onSaved();
        return;
      }
      setDeletionResult(result);
      const df = new Date(result.date).toLocaleDateString('de-AT');
      showToast('Löschung geplant für ' + df, 'success');
    } catch {
      showToast('Löschung fehlgeschlagen', 'error');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></svg> {name}
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <form onSubmit={handleSave}>
          <div className="modal-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">SV-Nummer</label>
                <input className="form-input" placeholder="XXXX TTMMJJ" value={form.svnr} onChange={(e) => set('svnr', e.target.value)} />
                {svnrWarning && <div style={{ color: '#d97706', fontSize: 11.5, marginTop: 5, fontWeight: 600 }}>⚠ SV-Nummer stimmt nicht mit dem Geburtsdatum überein</div>}
              </div>
              <div className="form-group">
                <label className="form-label">Geburtsdatum</label>
                <input type="date" className="form-input" min="1900-01-01" value={form.dob} onChange={(e) => set('dob', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Adresse</label>
              <input className="form-input" value={form.adresse} onChange={(e) => set('adresse', e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Telefon</label>
                <input type="tel" className="form-input" value={form.tel} onChange={(e) => set('tel', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">E-Mail</label>
                <input type="email" className="form-input" placeholder="patient@email.at" value={form.email} onChange={(e) => set('email', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Versicherung</label>
              <select className="form-input" value={form.versicherung} onChange={(e) => set('versicherung', e.target.value)}>
                <option>ÖGK</option><option>BVAEB</option><option>SVS</option><option>Andere</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Geschlecht</label>
              <select className="form-input" value={form.geschlecht} onChange={(e) => set('geschlecht', e.target.value)}>
                <option value="">Keine Angabe</option>
                <option value="m">Männlich</option>
                <option value="w">Weiblich</option>
                <option value="d">Divers</option>
              </select>
            </div>

            <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: 12, marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#0E5E56', marginBottom: 8 }}>Neuen Termin buchen</div>
              <button
                type="button" onClick={() => setNewTerminOpen(true)}
                style={{ display: 'block', width: 'auto', minWidth: 160, margin: '0 auto', padding: '8px 22px', background: '#EAF4F1', border: '1px solid #bfdbfe', borderRadius: 12, color: '#0E5E56', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Termin buchen
              </button>
            </div>

            <div style={{ background: '#fef2f2', borderLeft: '4px solid #dc2626', borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: 12, marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#991b1b', marginBottom: 6 }}>Passwort zurücksetzen</div>
              <div style={{ fontSize: 11, color: '#7f1d1d', marginBottom: 8 }}>Erstellt ein neues temporäres Passwort — der/die Patient/in muss es beim nächsten Login durch ein eigenes ersetzen.</div>
              {newPassword && (
                <div style={{ background: 'white', border: '1.5px dashed #fca5a5', borderRadius: 8, padding: '8px 10px', marginBottom: 8, fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: '#0f172a', textAlign: 'center' }}>
                  Neues Passwort: {newPassword}
                </div>
              )}
              <button
                type="button" disabled={resetting} onClick={handleResetPassword}
                style={{ width: '100%', padding: 8, background: 'white', border: '1.5px solid #dc2626', borderRadius: 12, color: '#dc2626', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {resetting ? 'Wird erstellt...' : newPassword ? 'Erneut generieren' : 'Neues Passwort generieren'}
              </button>
            </div>

            <div style={{ background: '#fef2f2', borderLeft: '4px solid #7f1d1d', borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: 12, marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#991b1b', marginBottom: 6 }}>Datenlöschung beantragen (DSGVO)</div>
              <div style={{ fontSize: 11, color: '#7f1d1d', marginBottom: 8 }}>Prüft automatisch die gesetzliche Aufbewahrungsfrist (10 Jahre nach letzter Behandlung, § 51 ÄrzteG) und anonymisiert sofort oder plant den frühestmöglichen gesetzlich zulässigen Termin.</div>
              {deletionResult && !deletionResult.anonymizedImmediately && (
                <div style={{ background: 'white', border: '1.5px dashed #7f1d1d', borderRadius: 8, padding: '8px 10px', marginBottom: 8, fontSize: 12, fontWeight: 700, color: '#0f172a', textAlign: 'center' }}>
                  Portal-Zugang gelöscht. Karteidaten bleiben bis {new Date(deletionResult.date).toLocaleDateString('de-AT')} gespeichert (gesetzliche Aufbewahrungsfrist § 51 ÄrzteG: 10 Jahre nach letzter Behandlung), dann Löschung.
                </div>
              )}
              <button
                type="button" disabled={deleting} onClick={handleRequestDeletion}
                style={{ width: '100%', padding: 8, background: 'white', border: '1.5px solid #7f1d1d', borderRadius: 12, color: '#7f1d1d', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {deleting ? 'Wird geprüft...' : 'Löschung beantragen'}
              </button>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn-cancel" type="button" onClick={onClose}>Abbrechen</button>
            <button className="btn-confirm" type="submit" disabled={saving}>{saving ? 'Wird gespeichert...' : 'Änderungen speichern'}</button>
          </div>
        </form>
      </div>
      {newTerminOpen && (
        <NewTerminModal
          defaultDate={todayStr()}
          practiceHours={practice && practice.working_hours}
          initialPatient={patient}
          onClose={() => setNewTerminOpen(false)}
          onCreated={() => setNewTerminOpen(false)}
        />
      )}
    </div>
  );
}
