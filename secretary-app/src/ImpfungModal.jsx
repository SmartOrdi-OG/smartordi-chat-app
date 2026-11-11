import { useState } from 'react';
import { VACCINE_NAMES, VACCINE_DOSE_LABELS, addImpfungEntry } from './lib/impfungenData';
import { showToast } from './lib/toast';

const SONSTIGE = 'Sonstige';
const todayIso = () => new Date().toISOString().split('T')[0];

// Mirrors secretary.html's #nachrichtenVacPane ("Impfung eintragen",
// opened from the chat pane's "Aktionen" menu) -- a modal here instead of
// a dedicated third CSS-toggled column, same "simplify the surrounding
// chrome, keep the real functionality" approach the rest of this app uses.
export default function ImpfungModal({ patient, profile, onClose, onSaved }) {
  const [name, setName] = useState(VACCINE_NAMES[0].name);
  const [customName, setCustomName] = useState('');
  const [datum, setDatum] = useState(todayIso());
  const [dosis, setDosis] = useState(VACCINE_DOSE_LABELS[0]);
  const [next, setNext] = useState('');
  const [charge, setCharge] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    let vaccineName = name;
    if (name === SONSTIGE) {
      vaccineName = customName.trim();
      if (!vaccineName) { showToast('Bitte Impfstoffname eingeben', 'error'); return; }
    }
    if (!datum) { showToast('Bitte Datum eingeben', 'error'); return; }
    const vaccine = VACCINE_NAMES.find((v) => v.name === vaccineName);
    setSaving(true);
    try {
      await addImpfungEntry(patient.id, { vaccineKey: vaccine ? vaccine.key : null, vaccineName, doseLabel: dosis, datum, nextDue: next || null, charge: charge || null }, profile?.id || null);
      showToast('✓ Impfung eingetragen für ' + (patient.fullName || patient.name));
      onSaved?.();
      onClose();
    } catch {
      showToast('✗ Speichern fehlgeschlagen', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">Impfung eintragen — {patient.fullName || patient.name}</div>
          <button className="modal-close" type="button" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Impfstoff</label>
            <select className="form-input" value={name} onChange={(e) => setName(e.target.value)}>
              {VACCINE_NAMES.map((v) => <option key={v.key} value={v.name}>{v.name}</option>)}
              <option value={SONSTIGE}>{SONSTIGE}</option>
            </select>
            {name === SONSTIGE && (
              <input className="form-input" placeholder="Impfstoffname eingeben..." style={{ marginTop: 6 }} value={customName} onChange={(e) => setCustomName(e.target.value)} />
            )}
          </div>
          <div className="form-group">
            <label className="form-label">Datum</label>
            <input className="form-input" type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Dosis</label>
            <select className="form-input" value={dosis} onChange={(e) => setDosis(e.target.value)}>
              {VACCINE_DOSE_LABELS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Nächste Auffrischung (optional)</label>
            <input className="form-input" type="date" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Chargennummer (optional)</label>
            <input className="form-input" placeholder="z.B. A12345B" value={charge} onChange={(e) => setCharge(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" type="button" onClick={onClose}>Abbrechen</button>
          <button className="btn-confirm" type="button" disabled={saving} onClick={handleSubmit}>{saving ? 'Speichert...' : '✓ Impfung speichern'}</button>
        </div>
      </div>
    </div>
  );
}
