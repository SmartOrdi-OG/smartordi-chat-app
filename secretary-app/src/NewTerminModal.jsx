import { useEffect, useState } from 'react';
import { searchPatients } from './lib/patientsData';
import { listArztStaff, createTermin, findTerminConflict } from './lib/termineData';
import { showToast } from './lib/toast';
import PatientSearchResults from './PatientSearchResults';

const ART_OPTIONS = ['Ordination', 'Kontrolle', 'Erstgespräch', 'Folgetermin', 'Arbeitsunfähigkeitsmeldung', 'Pflegefreistellung'];

// Mirrors secretary.html's "+ Neuer Termin" modal + confirmNewTermin().
// Uhrzeit/Bis are plain time inputs here instead of the original's
// working-hours-aware slot <select>s -- Öffnungszeiten isn't built in this
// app yet.
export default function NewTerminModal({ defaultDate, onClose, onCreated }) {
  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState([]);
  const [patient, setPatient] = useState(null);
  const [arztList, setArztList] = useState([]);
  const [arztId, setArztId] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('09:00');
  const [endTime, setEndTime] = useState('09:15');
  const [art, setArt] = useState(ART_OPTIONS[0]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listArztStaff().then((list) => {
      setArztList(list);
      if (list.length) setArztId(list[0].id);
    });
  }, []);

  function onPatientSearch(value) {
    setPatientQuery(value);
    setPatient(null);
    if (!value.trim()) { setPatientResults([]); return; }
    searchPatients(value, 20).then(setPatientResults);
  }

  function selectPatient(p) {
    setPatient(p);
    setPatientQuery(p.fullName || p.name);
    setPatientResults([]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!patient) { showToast('Bitte Patient wählen', 'error'); return; }
    if (!date) { showToast('Bitte Datum wählen', 'error'); return; }
    if (endTime <= time) { showToast('Endzeit muss nach der Startzeit liegen', 'error'); return; }
    setSubmitting(true);
    try {
      const patientName = patient.fullName || patient.name;
      const conflict = await findTerminConflict({ date, time, endTime, arztId, patientName });
      if (conflict) {
        showToast(conflict === 'patient' ? 'Dieser Patient hat zu dieser Zeit bereits einen anderen Termin' : 'Dieser Arzt/diese Ärztin hat zu dieser Zeit bereits einen Termin', 'error');
        return;
      }
      const termin = await createTermin({
        patientId: patient.id, patientName, art, date, time, endTime, arztId,
        versicherung: patient.versicherung, tel: patient.tel,
      });
      showToast('Termin gebucht: ' + art + ' · ' + new Date(date).toLocaleDateString('de-AT') + ' ' + time, 'success');
      onCreated(termin);
    } catch (err) {
      console.error('createTermin failed', err);
      showToast('Termin konnte nicht gespeichert werden', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">+ Neuer Termin</div>
          <button className="modal-close" type="button" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Patient</label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text" className="form-input" placeholder="Name oder SV-Nummer suchen..." autoComplete="off"
                  value={patientQuery}
                  onChange={(e) => onPatientSearch(e.target.value)}
                />
                {patientResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, marginTop: 4, maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 20 }}>
                    <PatientSearchResults results={patientResults} onSelect={selectPatient} />
                  </div>
                )}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Arzt/Ärztin</label>
              <select className="form-input" value={arztId} onChange={(e) => setArztId(e.target.value)}>
                {arztList.map((a) => <option key={a.id} value={a.id}>{a.full_name}{a.fach ? ' · ' + a.fach : ''}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Datum</label>
              <input type="date" className="form-input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Uhrzeit</label>
                <input type="time" className="form-input" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Bis</label>
                <input type="time" className="form-input" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Terminart</label>
              <select className="form-input" value={art} onChange={(e) => setArt(e.target.value)}>
                {ART_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn-cancel" type="button" onClick={onClose}>Abbrechen</button>
            <button className="btn-confirm" type="submit" disabled={submitting}>
              {submitting ? <span className="spinner-row"><span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} /> Wird gebucht...</span> : 'Termin erstellen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
