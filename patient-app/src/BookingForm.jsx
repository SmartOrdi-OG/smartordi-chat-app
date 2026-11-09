import { useEffect, useMemo, useState } from 'react';
import { patientBookTermin } from './lib/patientData';
import { DEFAULT_WORKING_HOURS, addMinutesToTime, buildTimeSlotsFromBlocks, todayStr, workingHoursFor } from './lib/workingHours';

const ART_OPTIONS = [
  'Ordination', 'Kontrolle', 'Erstgespräch', 'Impfung', 'Blutabnahme',
  'Arbeitsunfähigkeitsmeldung', 'Pflegefreistellung', 'Sonstige',
];

export default function BookingForm({ arzte, workingHours, onBooked }) {
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

  return (
    <>
      {arzte.length > 1 && (
        <select value={arztUsername} onChange={(e) => setArztUsername(e.target.value)}>
          {arzte.map((a) => (
            <option key={a.username} value={a.username}>{a.fullName}{a.fach ? ` · ${a.fach}` : ''}</option>
          ))}
        </select>
      )}

      <input type="date" min={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} />

      <select value={art} onChange={(e) => setArt(e.target.value)}>
        <option value="">Grund des Besuchs wählen…</option>
        {ART_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>

      {date && (
        dayHours && dayHours.open ? (
          <div className="time-slots">
            {slots.map((s) => (
              <button
                key={s}
                type="button"
                className={`time-slot${slot === s ? ' selected' : ''}`}
                onClick={() => setSlot(s)}
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, opacity: 0.85, textAlign: 'center', padding: '8px 0' }}>Praxis an diesem Tag geschlossen.</div>
        )
      )}

      {status && status.error && <div className="error-msg" style={{ marginTop: 10, marginBottom: 0 }}><span>!</span><span>{status.error}</span></div>}

      <button
        type="button"
        className="btn-book"
        disabled={!arztUsername || !date || !art || !slot || status === 'booking'}
        onClick={handleConfirm}
      >
        {status === 'booking' ? 'Wird gebucht…' : 'Termin bestätigen'}
      </button>
    </>
  );
}
