import { useState, useRef } from 'react';
import {
  searchPatients, isPatientLimitReached, getPlanLabelAndLimit,
  createPatientAccount, createLinkedChildAccount, buildPatientLoginUrl,
} from './lib/patientsData';
import { fetchPracticeAdminFach } from './lib/staffAuth';
import { renderQrDataUrl } from './lib/qr';
import { svnrMatchesDob } from './lib/svnr';
import { showToast } from './lib/toast';
import PatientSearchResults from './PatientSearchResults';

const EMPTY_FORM = {
  vorname: '', nachname: '', adresse: '', geburtsdatum: '', versicherung: 'ÖGK',
  svnr: '', geschlecht: '', telefon: '', email: '', isChild: false, childMode: 'new',
};

// Mirrors secretary.html's "+ Neuer Patient" modal + confirmNewPatient().
export default function NewPatientModal({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [childOwnerQuery, setChildOwnerQuery] = useState('');
  const [childOwnerResults, setChildOwnerResults] = useState([]);
  const [selectedChildOwner, setSelectedChildOwner] = useState(null);
  const searchTimer = useRef(null);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const svnrWarning = svnrMatchesDob(form.svnr, form.geburtsdatum) === false;

  function onChildOwnerSearch(query) {
    setChildOwnerQuery(query);
    clearTimeout(searchTimer.current);
    const q = query.trim();
    if (!q) { setChildOwnerResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      const results = (await searchPatients(q, 20)).filter((p) => p.isChild);
      setChildOwnerResults(results);
    }, 250);
  }

  function selectChildOwner(p) {
    setSelectedChildOwner(p);
    setChildOwnerQuery('');
    setChildOwnerResults([]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const vorname = form.vorname.trim();
    const nachname = form.nachname.trim();
    const adresse = form.adresse.trim();
    const telefon = form.telefon.trim();
    if (!vorname || !nachname) {
      showToast('Bitte Vor- und Nachname eingeben', 'error');
      return;
    }
    if (!adresse || !form.geburtsdatum || !telefon) {
      showToast('Bitte Adresse, Geburtsdatum und Telefon eingeben', 'error');
      return;
    }
    setSubmitting(true);
    try {
      if (await isPatientLimitReached()) {
        const { label, limit } = await getPlanLabelAndLimit();
        showToast('Patientenlimit des ' + label + '-Pakets erreicht (' + limit + ' Patienten). Bitte auf Enterprise upgraden.', 'error');
        return;
      }
      const extra = {
        adresse, dob: form.geburtsdatum, versicherung: form.versicherung,
        svnr: form.svnr.trim(), tel: telefon, email: form.email.trim(),
        geschlecht: form.geschlecht || null,
      };
      const fach = await fetchPracticeAdminFach();

      if (form.isChild && form.childMode === 'existing') {
        if (!selectedChildOwner) {
          showToast('Bitte zuerst das Konto des ersten Kindes auswählen', 'error');
          return;
        }
        try {
          await createLinkedChildAccount(vorname, nachname, fach, extra, selectedChildOwner.id);
          showToast(vorname + ' ' + nachname + ' wurde zum Konto von ' + (selectedChildOwner.fullName || selectedChildOwner.name) + ' hinzugefügt', 'success');
          onClose();
        } catch (err) {
          console.error('createLinkedChildAccount failed', err);
          showToast(err.message === 'USERNAME_COLLISION' ? 'Anlegen fehlgeschlagen: Bitte erneut versuchen.' : 'Kind angelegt, aber Verknüpfung fehlgeschlagen. Bitte Support kontaktieren.', 'error');
        }
        return;
      }

      try {
        const { username, password } = await createPatientAccount(vorname, nachname, fach, extra);
        const loginUrl = buildPatientLoginUrl(username, password, vorname, true);
        onCreated({
          name: vorname + ' ' + nachname,
          username, password,
          qrDataUrl: renderQrDataUrl(loginUrl),
          showCreds: false,
          description: form.isChild
            ? 'Für ' + vorname + ' ' + nachname + ' wurde ein Kinder-Konto vorbereitet. Drucken Sie diesen QR-Code aus und geben Sie ihn den Eltern — sie scannen ihn mit der Handykamera und wählen direkt einen eigenen Benutzernamen und ein eigenes Passwort für das Konto ihres Kindes.'
            : 'Für ' + vorname + ' ' + nachname + ' wurde ein Zugang vorbereitet. Drucken Sie diesen QR-Code aus und geben Sie ihn dem Patienten — er scannt ihn mit der Handykamera und wählt direkt einen eigenen Benutzernamen und ein eigenes Passwort für sein Konto.',
        });
      } catch (err) {
        console.error('createPatientAccount failed', err);
        showToast(err.message === 'USERNAME_COLLISION' ? 'Anlegen fehlgeschlagen: Benutzername bereits vergeben. Bitte erneut versuchen.' : 'Anlegen fehlgeschlagen', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">+ Neuer Patient</div>
          <button className="modal-close" type="button" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Nachname *</label>
                <input className="form-input" value={form.nachname} onChange={(e) => set('nachname', e.target.value)} autoComplete="off" />
              </div>
              <div className="form-group">
                <label className="form-label">Vorname *</label>
                <input className="form-input" value={form.vorname} onChange={(e) => set('vorname', e.target.value)} autoComplete="off" />
              </div>
            </div>

            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="npIsChild" style={{ width: 'auto' }} checked={form.isChild} onChange={(e) => set('isChild', e.target.checked)} />
              <label className="form-label" style={{ margin: 0 }} htmlFor="npIsChild">Kind</label>
            </div>

            {form.isChild && (
              <div className="form-group" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 12px' }}>
                <label className="form-label" style={{ marginBottom: 8 }}>Kinder-Konto</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#0f172a', cursor: 'pointer', marginBottom: 6 }}>
                  <input type="radio" name="npChildMode" checked={form.childMode === 'new'} onChange={() => set('childMode', 'new')} style={{ width: 'auto' }} />
                  Erstes Kind (neues Kinder-Konto)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#0f172a', cursor: 'pointer' }}>
                  <input type="radio" name="npChildMode" checked={form.childMode === 'existing'} onChange={() => set('childMode', 'existing')} style={{ width: 'auto' }} />
                  Weiteres Kind (bestehendes Kinder-Konto)
                </label>
                {form.childMode === 'existing' && (
                  <div style={{ marginTop: 10 }}>
                    <div className="patient-search" style={{ marginBottom: 6 }}>
                      <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg></span>
                      <input type="text" placeholder="Name des ersten Kindes suchen..." value={childOwnerQuery} onChange={(e) => onChildOwnerSearch(e.target.value)} />
                    </div>
                    {childOwnerQuery.trim() !== '' && <PatientSearchResults results={childOwnerResults} onSelect={selectChildOwner} />}
                    {selectedChildOwner && (
                      <div style={{ marginTop: 6, padding: '8px 10px', background: '#EAF4F1', borderRadius: 8, fontSize: 12.5, fontWeight: 700, color: '#0E5E56' }}>
                        ✓ {selectedChildOwner.fullName || selectedChildOwner.name}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Adresse *</label>
              <input className="form-input" value={form.adresse} onChange={(e) => set('adresse', e.target.value)} placeholder="Straße, PLZ Ort" autoComplete="off" />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Geburtsdatum *</label>
                <input type="date" className="form-input" min="1900-01-01" value={form.geburtsdatum} onChange={(e) => set('geburtsdatum', e.target.value)} autoComplete="off" />
              </div>
              <div className="form-group">
                <label className="form-label">Versicherung</label>
                <select className="form-input" value={form.versicherung} onChange={(e) => set('versicherung', e.target.value)}>
                  <option>ÖGK</option><option>BVAEB</option><option>SVS</option><option>Andere</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">SV-Nummer</label>
              <input className="form-input" placeholder="XXXX TTMMJJ" value={form.svnr} onChange={(e) => set('svnr', e.target.value)} autoComplete="off" />
              {svnrWarning && <div style={{ color: '#d97706', fontSize: 11.5, marginTop: 5, fontWeight: 600 }}>⚠ SV-Nummer stimmt nicht mit dem Geburtsdatum überein</div>}
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

            <div className="form-group">
              <label className="form-label">Telefon *</label>
              <input type="tel" className="form-input" placeholder="+43 ..." value={form.telefon} onChange={(e) => set('telefon', e.target.value)} autoComplete="off" />
            </div>

            <div className="form-group">
              <label className="form-label">E-Mail (optional)</label>
              <input type="email" className="form-input" placeholder="patient@email.at" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="off" />
            </div>

            <div style={{ fontSize: 11, color: '#94a3b8', margin: '-4px 0 4px' }}>* Pflichtfeld</div>
            <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: 10, fontSize: 11, color: '#854d0e', fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}>
              Diagnosen &amp; medizinische Daten werden nur vom Arzt eingetragen
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn-cancel" type="button" onClick={onClose}>Abbrechen</button>
            <button className="btn-confirm" type="submit" disabled={submitting}>
              {submitting ? <span className="spinner-row"><span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} /> Wird angelegt...</span> : 'Patient anlegen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
