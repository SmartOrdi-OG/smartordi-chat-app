import { useState } from 'react';
import { moveTermin } from './lib/termineData';
import { showToast } from './lib/toast';

// Mirrors secretary.html's "Termin verschieben" modal + confirmMove().
export default function MoveTerminModal({ termin, onClose, onMoved }) {
  const [date, setDate] = useState(termin.date);
  const [time, setTime] = useState(termin.time);
  const [endTime, setEndTime] = useState(termin.endTime || termin.time);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (endTime <= time) { showToast('Endzeit muss nach der Startzeit liegen', 'error'); return; }
    setSubmitting(true);
    try {
      const moved = await moveTermin(termin.id, { date, time, endTime });
      if (!moved) { showToast('Verschieben fehlgeschlagen', 'error'); return; }
      onMoved(moved);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><polyline points="7 8 12 3 17 8" /><polyline points="7 16 12 21 17 16" /><line x1="12" y1="3" x2="12" y2="21" /></svg> Termin verschieben
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
              Patient: <strong>{termin.patient}</strong> · Aktuell: <strong>{termin.date} {termin.time}</strong>
            </div>
            <div className="form-group">
              <label className="form-label">Neues Datum</label>
              <input type="date" className="form-input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Neue Uhrzeit</label>
                <input type="time" className="form-input" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Bis</label>
                <input type="time" className="form-input" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn-cancel" type="button" onClick={onClose}>Abbrechen</button>
            <button className="btn-confirm" type="submit" disabled={submitting}>Verschieben</button>
          </div>
        </form>
      </div>
    </div>
  );
}
