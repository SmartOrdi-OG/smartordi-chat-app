import { useState } from 'react';
import { WH_DAYS, DEFAULT_WORKING_HOURS, saveWorkingHours } from './lib/workingHoursData';
import { showToast } from './lib/toast';

function buildInitialForm(currentHours) {
  const hours = currentHours || DEFAULT_WORKING_HOURS;
  const form = {};
  WH_DAYS.forEach(([key]) => {
    const d = hours[key] || { open: false, blocks: [] };
    form[key] = {
      open: !!d.open,
      ranges: [0, 1].map((i) => ({
        on: !!d.blocks[i],
        s: (d.blocks[i] && d.blocks[i][0]) || '',
        e: (d.blocks[i] && d.blocks[i][1]) || '',
      })),
    };
  });
  return form;
}

// Mirrors secretary.html's #workingHoursModal + openWorkingHoursModal()/
// toggleWhDayFields()/saveWorkingHours() -- each day has an independent
// open/closed checkbox plus up to two independent time ranges (a range
// being merely "available but unchecked" is a distinct state from "set to
// 00:00", same reasoning as the original).
export default function WorkingHoursModal({ practiceId, currentHours, onClose, onSaved }) {
  const [form, setForm] = useState(() => buildInitialForm(currentHours));
  const [saving, setSaving] = useState(false);

  function setDayOpen(key, open) {
    setForm((f) => ({ ...f, [key]: { ...f[key], open } }));
  }
  function setRange(key, idx, patch) {
    setForm((f) => {
      const ranges = f[key].ranges.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      return { ...f, [key]: { ...f[key], ranges } };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const next = {};
    for (const [key] of WH_DAYS) {
      const day = form[key];
      if (day.open && !day.ranges.some((r) => r.on)) {
        showToast('Bitte für jeden geöffneten Tag mindestens einen Zeitraum angeben', 'error');
        return;
      }
      for (const r of day.ranges) {
        if (r.on && (!r.s || !r.e)) {
          showToast('Bitte Von und Bis für den markierten Zeitraum angeben, oder das Häkchen entfernen', 'error');
          return;
        }
        if (r.s && r.e && r.e <= r.s) {
          showToast('Bis muss nach Von liegen', 'error');
          return;
        }
      }
      next[key] = { open: day.open, blocks: day.ranges.filter((r) => r.on && r.s && r.e).map((r) => [r.s, r.e]) };
    }
    setSaving(true);
    try {
      const ok = await saveWorkingHours(practiceId, next);
      if (!ok) { showToast('Speichern fehlgeschlagen', 'error'); return; }
      showToast('Öffnungszeiten gespeichert', 'success');
      onSaved(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg> Öffnungszeiten
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 10 }}>
              Nur an geöffneten Tagen/Zeiten können neue Termine gebucht werden — für Patient*innen und im Sekretariat gleichermaßen. Ein zweiter Zeitraum pro Tag ist optional (z.B. für eine Mittagspause).
            </div>
            {WH_DAYS.map(([key, label]) => {
              const day = form[key];
              return (
                <div key={key} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600 }}>
                    <input type="checkbox" checked={day.open} onChange={(e) => setDayOpen(key, e.target.checked)} /> {label}
                  </label>
                  {[0, 1].map((idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: '#64748b', width: 110, flexShrink: 0 }}>
                        <input
                          type="checkbox" disabled={!day.open}
                          checked={day.ranges[idx].on}
                          onChange={(e) => setRange(key, idx, { on: e.target.checked })}
                        /> {idx === 0 ? 'Zeitraum 1' : '+ Zeitraum 2'}
                      </label>
                      <input
                        type="time" disabled={!day.open || !day.ranges[idx].on} value={day.ranges[idx].s}
                        onChange={(e) => setRange(key, idx, { s: e.target.value })}
                        style={{ width: 84, padding: '4px 5px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11.5, fontFamily: 'inherit' }}
                      />
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>–</span>
                      <input
                        type="time" disabled={!day.open || !day.ranges[idx].on} value={day.ranges[idx].e}
                        onChange={(e) => setRange(key, idx, { e: e.target.value })}
                        style={{ width: 84, padding: '4px 5px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11.5, fontFamily: 'inherit' }}
                      />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="modal-footer">
            <button className="btn-cancel" type="button" onClick={onClose}>Abbrechen</button>
            <button className="btn-confirm" type="submit" disabled={saving}>{saving ? 'Wird gespeichert...' : 'Speichern'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
