import { Icon } from './icons';

// Phase 1 (visual shell only): mirrors secretary.html's #view-uebersicht
// layout (stats row, today's Termine card, QR invite card, messages/recall
// placeholders) with static/mock numbers -- no real Supabase data wired up
// yet. Each section stays easy to slot real data into later (phase 2+).
export default function UebersichtView() {
  return (
    <div className="view active">
      <div className="view-header">
        <div className="view-title">Übersicht</div>
        <div className="view-sub">Montag, 10. November 2026</div>
      </div>
      <div className="scroll-content">
        <div className="stats-row">
          <div className="stat-box">
            <div className="stat-num">8</div>
            <div className="stat-label">Termine heute</div>
          </div>
          <div className="stat-box">
            <div className="stat-num" style={{ color: 'var(--amber)' }}>3</div>
            <div className="stat-label">Ausstehend</div>
          </div>
          <div className="stat-box">
            <div className="stat-num" style={{ color: 'var(--brand)' }}>0</div>
            <div className="stat-label">Nachrichten</div>
          </div>
        </div>

        <div className="dash-grid-2col">
          <div className="dash-section">
            <div className="section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Heutige Termine</span>
              <span style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 600, cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>Alle sehen →</span>
            </div>
            <div className="card">
              <div className="card-body" style={{ padding: '0 16px' }}>
                <div className="empty-placeholder">Terminliste folgt</div>
              </div>
            </div>
          </div>

          <div className="dash-section">
            <div className="section-title">Patienten einladen</div>
            <div className="qr-card">
              <div className="qr-img" />
              <div className="qr-info">
                <div className="qr-title">Patienten-QR-Code</div>
                <div className="qr-sub">Drucken Sie diesen Code aus und geben Sie ihn Ihren Patienten mit — direkt zur Selbstregistrierung fürs Patientenportal.</div>
                <button className="qr-print-btn" type="button">
                  <Icon name="print" size={14} />
                  Ausdrucken
                </button>
              </div>
            </div>
          </div>

          <div className="dash-section">
            <div className="section-title">Neue Patientennachrichten</div>
            <div className="card">
              <div className="card-body" style={{ padding: 0 }}>
                <div className="empty-placeholder">Keine neuen Nachrichten</div>
              </div>
            </div>
          </div>

          <div className="dash-section">
            <div className="section-title">Kontrollpatienten fällig</div>
            <div className="card">
              <div className="card-body" style={{ padding: 0 }}>
                <div className="empty-placeholder">Keine fälligen Kontrollen</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
