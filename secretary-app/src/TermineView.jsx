import { useEffect, useState } from 'react';
import { Icon } from './icons';
import NewTerminModal from './NewTerminModal';
import MoveTerminModal from './MoveTerminModal';
import WorkingHoursModal from './WorkingHoursModal';
import { sendMessageToPatient } from './lib/patientsData';
import {
  listTermineForDate, listArztStaff, updateTerminStatus,
  buildTerminConfirmedText, buildTerminMovedText, buildTerminCancelledText,
} from './lib/termineData';
import { fetchPracticeSettings } from './lib/staffAuth';
import { isOnlineBookingEnabled, setOnlineBookingEnabled } from './lib/onlineBookingData';
import { showToast } from './lib/toast';

function todayStr() {
  return new Date().toISOString().split('T')[0];
}
function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().split('T')[0];
}
function dateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const label = d.toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return dateStr === todayStr() ? 'Heute — ' + label : label;
}

const STATUS_LABEL = {
  bestaetigt: { text: 'Bestätigt', cls: 't-confirmed' },
  abgesagt: { text: 'Abgesagt', cls: 't-cancelled' },
  nicht_erschienen: { text: 'Nicht erschienen', cls: 't-noshow' },
};

function TerminRow({ t, arztName, onConfirm, onMove, onCancel }) {
  const status = STATUS_LABEL[t.status] || { text: 'Neu', cls: 't-pending' };
  const timeRange = t.time + (t.endTime ? '–' + t.endTime : '');
  const actionable = t.status !== 'abgesagt' && t.status !== 'nicht_erschienen';
  return (
    <div className="termin-item">
      <div className="t-time-box"><div className="t-time">{t.time}</div></div>
      <div className="t-info">
        <div className="t-patient">{t.patient}</div>
        <div className="t-type">{timeRange} · {arztName || '—'} · {t.art}{t.versicherung ? ' · ' + t.versicherung : ''}{t.tel ? ' · ' + t.tel : ''}</div>
        {actionable && (
          <div className="t-actions">
            {t.status !== 'bestaetigt' && (
              <button className="t-btn t-btn-confirm" type="button" onClick={() => onConfirm(t)}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><polyline points="20 6 9 17 4 12" /></svg> Bestätigen
              </button>
            )}
            <button className="t-btn t-btn-move" type="button" onClick={() => onMove(t)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><polyline points="7 8 12 3 17 8" /><polyline points="7 16 12 21 17 16" /><line x1="12" y1="3" x2="12" y2="21" /></svg> Verschieben
            </button>
            <button className="t-btn t-btn-cancel" type="button" onClick={() => onCancel(t)}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg> Absagen
            </button>
          </div>
        )}
      </div>
      <span className={`t-status ${status.cls}`}>{status.text}</span>
    </div>
  );
}

// Mirrors secretary.html's #view-termine -- simplified to a single day's
// agenda (prev/today/next navigation) instead of the original's month-grid
// calendar with a draggable floating day window. "Öffnungszeiten" is
// configurable (Phase 8) and "+ Neuer Termin" now generates its Uhrzeit/Bis
// slots from it (Phase 9) -- same as the original, "Verschieben" stays a
// plain time input either way. Phase 13 adds the "Online-Buchung"
// aktiv/gesperrt toggle.
export default function TermineView() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [termine, setTermine] = useState([]);
  const [loading, setLoading] = useState(true);
  const [arztById, setArztById] = useState({});
  const [newTerminOpen, setNewTerminOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState(null);
  const [workingHoursOpen, setWorkingHoursOpen] = useState(false);
  const [practice, setPractice] = useState(null);

  function refresh() {
    setLoading(true);
    listTermineForDate(date).then((list) => {
      setTermine(list);
      setLoading(false);
    });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    listArztStaff().then((list) => {
      const map = {};
      list.forEach((a) => { map[a.id] = a.full_name; });
      setArztById(map);
    });
    fetchPracticeSettings().then(setPractice);
  }, []);

  async function handleConfirm(t) {
    const updated = await updateTerminStatus(t.id, 'bestaetigt');
    if (!updated) { showToast('Bestätigen fehlgeschlagen', 'error'); return; }
    let messaged = false;
    if (t.patientId) {
      try { await sendMessageToPatient(t.patientId, buildTerminConfirmedText(updated, arztById[t.arztId])); messaged = true; } catch { /* best-effort */ }
    }
    showToast(messaged ? 'Bestätigt · Patient per Chat benachrichtigt' : 'Bestätigt', 'success');
    refresh();
  }

  async function handleCancel(t) {
    const updated = await updateTerminStatus(t.id, 'abgesagt');
    if (!updated) { showToast('Absagen fehlgeschlagen', 'error'); return; }
    let messaged = false;
    if (t.patientId) {
      try { await sendMessageToPatient(t.patientId, buildTerminCancelledText(updated)); messaged = true; } catch { /* best-effort */ }
    }
    showToast(messaged ? 'Abgesagt · Patient per Chat informiert' : 'Abgesagt');
    refresh();
  }

  async function handleToggleOnlineBooking() {
    const next = !isOnlineBookingEnabled(practice);
    const ok = await setOnlineBookingEnabled(practice.id, next);
    if (!ok) { showToast('Speichern fehlgeschlagen', 'error'); return; }
    setPractice((p) => ({ ...p, online_booking_enabled: next }));
    showToast(next ? 'Online-Buchung aktiviert' : 'Online-Buchung für Patienten gesperrt');
  }

  async function handleMoved(updated) {
    setMoveTarget(null);
    let messaged = false;
    if (updated.patientId) {
      try { await sendMessageToPatient(updated.patientId, buildTerminMovedText(updated, arztById[updated.arztId])); messaged = true; } catch { /* best-effort */ }
    }
    showToast(messaged ? 'Termin verschoben · Patient per Chat benachrichtigt' : 'Termin verschoben', 'success');
    refresh();
  }

  return (
    <div className="view active">
      <div className="view-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div>
            <div className="view-title">Terminverwaltung</div>
            <div className="view-sub">Bestätigen · Verschieben · Absagen</div>
          </div>
          <button className="patient-actions-toggle" type="button" onClick={() => setMenuOpen((v) => !v)}>
            <Icon name="menu" size={15} /> Aktionen
          </button>
          <div className={`patient-actions-menu${menuOpen ? ' show' : ''}`}>
            {practice && (
              <button
                className="rail-btn" type="button"
                style={isOnlineBookingEnabled(practice) ? undefined : { color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2' }}
                onClick={() => { setMenuOpen(false); handleToggleOnlineBooking(); }}
              >
                {isOnlineBookingEnabled(practice) ? 'Online-Buchung aktiv' : 'Online-Buchung gesperrt'}
              </button>
            )}
            <button className="rail-btn" type="button" onClick={() => { setMenuOpen(false); setWorkingHoursOpen(true); }}>
              <span className="rail-btn-icon"><Icon name="clock" /></span> Öffnungszeiten
            </button>
            <div className="rail-divider" />
            <button className="rail-btn rail-btn-primary" type="button" onClick={() => { setMenuOpen(false); setNewTerminOpen(true); }}>
              <span className="rail-btn-icon"><Icon name="calendarPlus" /></span> Neuer Termin
            </button>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'white' }}>
        <button className="btn-cancel" type="button" style={{ padding: '6px 10px' }} onClick={() => setDate((d) => addDays(d, -1))}>‹</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{dateLabel(date)}</div>
        <button className="btn-cancel" type="button" style={{ padding: '6px 10px' }} onClick={() => setDate((d) => addDays(d, 1))}>›</button>
        {date !== todayStr() && (
          <button className="btn-cancel" type="button" onClick={() => setDate(todayStr())}>Heute</button>
        )}
      </div>
      <div className="scroll-content">
        {loading && <div className="empty-placeholder">Lädt...</div>}
        {!loading && termine.length === 0 && <div className="empty-placeholder">Keine Termine an diesem Tag</div>}
        {!loading && termine.map((t) => (
          <TerminRow key={t.id} t={t} arztName={arztById[t.arztId]} onConfirm={handleConfirm} onMove={setMoveTarget} onCancel={handleCancel} />
        ))}
      </div>

      {newTerminOpen && (
        <NewTerminModal
          defaultDate={date}
          practiceHours={practice && practice.working_hours}
          onClose={() => setNewTerminOpen(false)}
          onCreated={() => { setNewTerminOpen(false); refresh(); }}
        />
      )}
      {moveTarget && (
        <MoveTerminModal
          termin={moveTarget}
          onClose={() => setMoveTarget(null)}
          onMoved={handleMoved}
        />
      )}
      {workingHoursOpen && practice && (
        <WorkingHoursModal
          practiceId={practice.id}
          currentHours={practice.working_hours}
          onClose={() => setWorkingHoursOpen(false)}
          onSaved={(hours) => { setWorkingHoursOpen(false); setPractice((p) => ({ ...p, working_hours: hours })); }}
        />
      )}
    </div>
  );
}
