import { useEffect, useMemo, useState } from 'react';
import { patientBookTermin } from './lib/patientData';
import { DEFAULT_WORKING_HOURS, addMinutesToTime, buildTimeSlotsFromBlocks, todayStr, workingHoursFor } from './lib/workingHours';

const ART_OPTIONS = [
  'Ordination', 'Kontrolle', 'Erstgespräch', 'Impfung', 'Blutabnahme',
  'Arbeitsunfähigkeitsmeldung', 'Pflegefreistellung', 'Sonstige',
];

export default function BookingForm({ arzte, workingHours, bookingEnabled, onBooked, onCancel }) {
  const [arztUsername, setArztUsername] = useState(arzte[0]?.username || '');
  const [date, setDate] = useState('');
  const [art, setArt] = useState('');
  const [slot, setSlot] = useState(null);
  const [status, setStatus] = useState(null); // null | 'booking' | {error}

  const hours = workingHours || DEFAULT_WORKING_HOURS;
  const dayHours = date ? workingHoursFor(date, hours) : null;
  const slots = useMemo(() => (dayHours && dayHours.open ? buildTimeSlotsFromBlocks(dayHours.blocks) : []), [date]);

  useEffect(() => { setSlot(null); }, [date]);

  async function handleConfirm() {
    if (!arztUsername || !date || !art || !slot) return;
    setStatus('booking');
    try {
      await patientBookTermin({
        arztUsername, date, time: slot, endTime: addMinutesToTime(slot, 20), art,
      });
      onBooked();
    } catch (err) {
      const msg = (err && err.message) || '';
      const key = msg.indexOf('slot_taken') !== -1
        ? 'Dieser Termin ist leider schon vergeben. Bitte wählen Sie einen anderen.'
        : msg.indexOf('patient_already_booked') !== -1
        ? 'Sie haben zu dieser Zeit bereits einen Termin.'
        : msg.indexOf('booking_disabled') !== -1
        ? 'Die Online-Terminbuchung ist derzeit nicht verfügbar.'
        : 'Buchung fehlgeschlagen. Bitte versuchen Sie es erneut.';
      setStatus({ error: key });
    }
  }

  if (!bookingEnabled) {
    return <div className="empty-state">Die Online-Terminbuchung ist derzeit nicht verfügbar.</div>;
  }

  return (
    <div className="booking-form">
      {arzte.length > 1 && (
        <div className="form-group">
          <label className="form-label">Arzt / Ärztin</label>
          <select className="form-input" value={arztUsername} onChange={(e) => setArztUsername(e.target.value)}>
            {arzte.map((a) => (
              <option key={a.username} value={a.username}>{a.fullName}{a.fach ? ` · ${a.fach}` : ''}</option>
            ))}
          </select>
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Datum</label>
        <input className="form-input" type="date" min={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="form-group">
        <label className="form-label">Grund des Besuchs</label>
        <select className="form-input" value={art} onChange={(e) => setArt(e.target.value)}>
          <option value="">Grund wählen…</option>
          {ART_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {date && (
        dayHours && dayHours.open ? (
          <div className="form-group">
            <label className="form-label">Uhrzeit</label>
            <div className="slot-grid">
              {slots.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`slot-btn${slot === s ? ' selected' : ''}`}
                  onClick={() => setSlot(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state">Praxis an diesem Tag geschlossen.</div>
        )
      )}

      {status && status.error && <div className="error-msg" style={{ marginTop: 12 }}><span>!</span><span>{status.error}</span></div>}

      <div className="booking-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>Abbrechen</button>
        <button
          type="button"
          className="btn-main"
          disabled={!arztUsername || !date || !art || !slot || status === 'booking'}
          onClick={handleConfirm}
        >
          {status === 'booking' ? 'Wird gebucht…' : 'Termin bestätigen'}
        </button>
      </div>
    </div>
  );
}
