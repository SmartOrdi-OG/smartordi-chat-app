import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from './LanguageContext';
import { patientBookTermin } from './lib/patientData';
import { DEFAULT_WORKING_HOURS, addMinutesToTime, buildTimeSlotsFromBlocks, workingHoursFor } from './lib/workingHours';

// The VALUE stored on the Termin (and read back everywhere else -- secretary-
// app, doctor.html's Kartei) is always this canonical German string, same
// as every other field this app keeps in German internally; only the
// OPTION LABEL shown to the patient is translated (termine.art.* keys).
const ART_OPTIONS = [
  { value: 'Ordination', key: 'termine.art.ordination' },
  { value: 'Kontrolle', key: 'termine.art.kontrolle' },
  { value: 'Erstgespräch', key: 'termine.art.erstgespraech' },
  { value: 'Impfung', key: 'termine.art.impfung' },
  { value: 'Blutabnahme', key: 'termine.art.blutabnahme' },
  { value: 'Arbeitsunfähigkeitsmeldung', key: 'termine.art.krankmeldung' },
  { value: 'Pflegefreistellung', key: 'termine.art.pflegefreistellung' },
  { value: 'Sonstige', key: 'termine.art.sonstige' },
];

// Date picking itself moved to Calendar.jsx (selectedDate is lifted into
// TermineTab) -- this just turns a selected day into a real booking, same
// as before.
export default function BookingForm({ arzte, workingHours, selectedDate, onBooked }) {
  const { t } = useLanguage();
  const [arztUsername, setArztUsername] = useState(arzte[0]?.username || '');
  const [art, setArt] = useState('');
  const [slot, setSlot] = useState(null);
  const [status, setStatus] = useState(null); // null | 'booking' | {error}

  const hours = workingHours || DEFAULT_WORKING_HOURS;
  const dayHours = selectedDate ? workingHoursFor(selectedDate, hours) : null;
  const slots = useMemo(() => (dayHours && dayHours.open ? buildTimeSlotsFromBlocks(dayHours.blocks) : []), [selectedDate]);

  useEffect(() => { setSlot(null); }, [selectedDate]);

  async function handleConfirm() {
    if (!arztUsername || !selectedDate || !art || !slot) return;
    setStatus('booking');
    try {
      const termin = await patientBookTermin({
        arztUsername, date: selectedDate, time: slot, endTime: addMinutesToTime(slot, 20), art,
      });
      setArt('');
      setSlot(null);
      setStatus(null);
      onBooked(termin);
    } catch (err) {
      const msg = (err && err.message) || '';
      const errKey = msg.indexOf('slot_taken') !== -1
        ? 'termine.toast.slotTaken'
        : msg.indexOf('patient_already_booked') !== -1
        ? 'termine.toast.patientAlreadyBooked'
        : msg.indexOf('booking_disabled') !== -1
        ? 'termine.bookingDisabled'
        : 'termine.bookingFailed';
      setStatus({ error: errKey });
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

      <select value={art} onChange={(e) => setArt(e.target.value)}>
        <option value="">{t('termine.art.choose')}</option>
        {ART_OPTIONS.map((a) => <option key={a.value} value={a.value}>{t(a.key)}</option>)}
      </select>

      {selectedDate && (
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
          <div style={{ fontSize: 12.5, opacity: 0.85, textAlign: 'center', padding: '8px 0' }}>{t('termine.closedDay')}</div>
        )
      )}

      {status && status.error && <div className="error-msg" style={{ marginTop: 10, marginBottom: 0 }}><span>!</span><span>{t(status.error)}</span></div>}

      <button
        type="button"
        className="btn-book"
        disabled={!arztUsername || !selectedDate || !art || !slot || status === 'booking'}
        onClick={handleConfirm}
      >
        {status === 'booking' ? t('termine.booking') : t('termine.confirmBtn')}
      </button>
    </>
  );
}
