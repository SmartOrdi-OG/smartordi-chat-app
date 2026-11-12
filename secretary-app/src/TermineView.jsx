import { useEffect, useState } from 'react';
import { Icon } from './icons';
import NewTerminModal from './NewTerminModal';
import MoveTerminModal from './MoveTerminModal';
import WorkingHoursModal from './WorkingHoursModal';
import { sendMessageToPatient } from './lib/patientsData';
import {
  listTermineForDate, listTermineForDateRange, listArztStaff, updateTerminStatus,
  buildTerminConfirmedText, buildTerminMovedText, buildTerminCancelledText,
} from './lib/termineData';
import { fetchPracticeSettings } from './lib/staffAuth';
import { isOnlineBookingEnabled, setOnlineBookingEnabled } from './lib/onlineBookingData';
import { listPatients } from './lib/patientsData';
import { dueVaccinationPatientIdSet } from './lib/vaccineSchedule';
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

function pad2(n) { return String(n).padStart(2, '0'); }
function toISODate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function monthAnchorOf(dateStr) { return dateStr.slice(0, 7); }
function addMonthsToAnchor(anchor, delta) {
  const [y, m] = anchor.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}
function monthLabel(anchor) {
  const [y, m] = anchor.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('de-AT', { month: 'long', year: 'numeric' });
}
const WEEKDAY_HEADERS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
// Mirrors secretary.html's own month-grid cell math -- a 6-row grid padded
// with the real adjacent month's day numbers (not blank cells) on both
// ends, same as the original.
function buildMonthGrid(anchor) {
  const [y, m] = anchor.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstWeekday = (first.getDay() + 6) % 7; // 0 = Montag
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const cellDate = new Date(y, m - 1, i - firstWeekday + 1);
    cells.push({ dateStr: toISODate(cellDate), dayNum: cellDate.getDate(), inMonth: cellDate.getMonth() === m - 1 });
  }
  return cells;
}

const STATUS_LABEL = {
  bestaetigt: { text: 'Bestätigt', cls: 't-confirmed' },
  abgesagt: { text: 'Abgesagt', cls: 't-cancelled' },
  nicht_erschienen: { text: 'Nicht erschienen', cls: 't-noshow' },
};

function TerminRow({ t, arztName, dueSet, onConfirm, onMove, onCancel }) {
  const status = STATUS_LABEL[t.status] || { text: 'Neu', cls: 't-pending' };
  const timeRange = t.time + (t.endTime ? '–' + t.endTime : '');
  const actionable = t.status !== 'abgesagt' && t.status !== 'nicht_erschienen';
  const vaccineDue = dueSet && t.patientId && dueSet.has(t.patientId);
  return (
    <div className="termin-item">
      <div className="t-time-box"><div className="t-time">{t.time}</div></div>
      <div className="t-info">
        <div className="t-patient">
          {t.patient}
          {vaccineDue && (
            <span title="Impfung fällig — Patient/in informieren" style={{ marginLeft: 5 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px', color: '#d97706' }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
            </span>
          )}
        </div>
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
// aktiv/gesperrt toggle. Phase 18 adds the Impfung-fällig badge next to a
// patient's name (keyed by patientId, not full-name text like the
// original's own dueSet -- avoids a same-name-collision bug already fixed
// elsewhere in this port).
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
  const [dueSet, setDueSet] = useState(null);
  const [viewMode, setViewMode] = useState('day');
  const [monthAnchor, setMonthAnchor] = useState(monthAnchorOf(todayStr()));
  const [monthTermine, setMonthTermine] = useState([]);
  const [monthLoading, setMonthLoading] = useState(true);
  const [dayDetailDate, setDayDetailDate] = useState(null);

  function refresh() {
    setLoading(true);
    listTermineForDate(date).then((list) => {
      setTermine(list);
      setLoading(false);
    });
  }

  const monthGrid = buildMonthGrid(monthAnchor);
  function refreshMonth() {
    setMonthLoading(true);
    listTermineForDateRange(monthGrid[0].dateStr, monthGrid[monthGrid.length - 1].dateStr).then((list) => {
      setMonthTermine(list);
      setMonthLoading(false);
    });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    if (viewMode === 'month') refreshMonth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, monthAnchor]);

  useEffect(() => {
    listArztStaff().then((list) => {
      const map = {};
      list.forEach((a) => { map[a.id] = a.full_name; });
      setArztById(map);
    });
    fetchPracticeSettings().then(setPractice);
    listPatients().then((patients) => dueVaccinationPatientIdSet(patients)).then(setDueSet);
  }, []);

  function refreshActive() {
    if (viewMode === 'month') refreshMonth();
    else refresh();
  }

  async function handleConfirm(t) {
    const updated = await updateTerminStatus(t.id, 'bestaetigt');
    if (!updated) { showToast('Bestätigen fehlgeschlagen', 'error'); return; }
    let messaged = false;
    if (t.patientId) {
      try {
        const msg = buildTerminConfirmedText(updated, arztById[t.arztId]);
        await sendMessageToPatient(t.patientId, msg.text, msg.msgKey, msg.msgParams);
        messaged = true;
      } catch { /* best-effort */ }
    }
    showToast(messaged ? 'Bestätigt · Patient per Chat benachrichtigt' : 'Bestätigt', 'success');
    refreshActive();
  }

  async function handleCancel(t) {
    const updated = await updateTerminStatus(t.id, 'abgesagt');
    if (!updated) { showToast('Absagen fehlgeschlagen', 'error'); return; }
    let messaged = false;
    if (t.patientId) {
      try {
        const msg = buildTerminCancelledText(updated);
        await sendMessageToPatient(t.patientId, msg.text, msg.msgKey, msg.msgParams);
        messaged = true;
      } catch { /* best-effort */ }
    }
    showToast(messaged ? 'Abgesagt · Patient per Chat informiert' : 'Abgesagt');
    refreshActive();
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
      try {
        const msg = buildTerminMovedText(updated, arztById[updated.arztId]);
        await sendMessageToPatient(updated.patientId, msg.text, msg.msgKey, msg.msgParams);
        messaged = true;
      } catch { /* best-effort */ }
    }
    showToast(messaged ? 'Termin verschoben · Patient per Chat benachrichtigt' : 'Termin verschoben', 'success');
    refreshActive();
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
        <div style={{ display: 'flex', borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
          <button
            type="button" onClick={() => setViewMode('day')}
            style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: viewMode === 'day' ? 'var(--brand)' : 'white', color: viewMode === 'day' ? 'white' : 'var(--text)' }}
          >Tag</button>
          <button
            type="button" onClick={() => setViewMode('month')}
            style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: viewMode === 'month' ? 'var(--brand)' : 'white', color: viewMode === 'month' ? 'white' : 'var(--text)' }}
          >Monat</button>
        </div>
      </div>
      {viewMode === 'day' ? (
        <>
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
              <TerminRow key={t.id} t={t} arztName={arztById[t.arztId]} dueSet={dueSet} onConfirm={handleConfirm} onMove={setMoveTarget} onCancel={handleCancel} />
            ))}
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'white' }}>
            <button className="btn-cancel" type="button" style={{ padding: '6px 10px' }} onClick={() => setMonthAnchor((a) => addMonthsToAnchor(a, -1))}>‹</button>
            <div style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{monthLabel(monthAnchor)}</div>
            <button className="btn-cancel" type="button" style={{ padding: '6px 10px' }} onClick={() => setMonthAnchor((a) => addMonthsToAnchor(a, 1))}>›</button>
            {monthAnchor !== monthAnchorOf(todayStr()) && (
              <button className="btn-cancel" type="button" onClick={() => setMonthAnchor(monthAnchorOf(todayStr()))}>Heute</button>
            )}
          </div>
          <div className="scroll-content" style={{ padding: 10 }}>
            {monthLoading && <div className="empty-placeholder">Lädt...</div>}
            {!monthLoading && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                {WEEKDAY_HEADERS.map((h) => (
                  <div key={h} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', padding: '2px 0' }}>{h}</div>
                ))}
                {monthGrid.map((cell) => {
                  const dayTermine = monthTermine.filter((t) => t.date === cell.dateStr);
                  const hasNeu = dayTermine.some((t) => t.status !== 'bestaetigt' && t.status !== 'abgesagt' && t.status !== 'nicht_erschienen');
                  const chips = dayTermine.slice(0, 3);
                  const overflow = dayTermine.length - chips.length;
                  const isToday = cell.dateStr === todayStr();
                  return (
                    <div
                      key={cell.dateStr} onClick={() => dayTermine.length && setDayDetailDate(cell.dateStr)}
                      style={{
                        minHeight: 72, borderRadius: 8, padding: 5, cursor: dayTermine.length ? 'pointer' : 'default',
                        background: isToday ? '#f0fdfa' : 'white', border: isToday ? '1.5px solid var(--brand)' : '1px solid var(--border)',
                        opacity: cell.inMonth ? 1 : 0.4,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{cell.dayNum}</span>
                        {hasNeu && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d97706' }} />}
                      </div>
                      {chips.map((t) => (
                        <div key={t.id} style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t.time} {(t.patient || '').split(' ')[0]}
                        </div>
                      ))}
                      {overflow > 0 && <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>+{overflow} mehr</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {dayDetailDate && (
        <div className="modal-overlay" onClick={() => setDayDetailDate(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{dateLabel(dayDetailDate)}</div>
              <button className="modal-close" type="button" onClick={() => setDayDetailDate(null)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="modal-body">
              {monthTermine.filter((t) => t.date === dayDetailDate).length === 0 && <div className="empty-placeholder">Keine Termine an diesem Tag</div>}
              {monthTermine.filter((t) => t.date === dayDetailDate).map((t) => (
                <TerminRow key={t.id} t={t} arztName={arztById[t.arztId]} dueSet={dueSet} onConfirm={handleConfirm} onMove={setMoveTarget} onCancel={handleCancel} />
              ))}
            </div>
          </div>
        </div>
      )}

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
