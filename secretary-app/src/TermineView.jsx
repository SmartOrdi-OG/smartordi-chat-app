import { useState } from 'react';
import { Icon } from './icons';

// Phase 1: mirrors secretary.html's #view-termine header (actions menu +
// "Neuer Termin") and scroll area. No real termine list/calendar yet.
export default function TermineView() {
  const [menuOpen, setMenuOpen] = useState(false);

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
            <button className="rail-btn" type="button">
              <span className="rail-btn-icon"><Icon name="clock" /></span> Öffnungszeiten
            </button>
            <div className="rail-divider" />
            <button className="rail-btn rail-btn-primary" type="button">
              <span className="rail-btn-icon"><Icon name="calendarPlus" /></span> Neuer Termin
            </button>
          </div>
        </div>
      </div>
      <div className="scroll-content">
        <div className="empty-placeholder">Terminkalender folgt</div>
      </div>
    </div>
  );
}
