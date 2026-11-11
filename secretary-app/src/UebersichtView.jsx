import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { fetchPracticeSettings } from './lib/staffAuth';
import { listTermineForDate } from './lib/termineData';
import { fetchUnreadMessageSummaries, buildGeneralRegisterUrl } from './lib/patientsData';
import { lastViewedFor } from './lib/unreadTracking';
import { renderQrDataUrl } from './lib/qr';

function todayStr() {
  return new Date().toISOString().split('T')[0];
}
const TODAY_LABEL = new Date().toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const STATUS_LABEL = { bestaetigt: 'Bestätigt', abgesagt: 'Abgesagt', nicht_erschienen: 'Nicht erschienen' };

// Mirrors secretary.html's #view-uebersicht -- Phase 1 built the layout
// with mock numbers, this phase wires up real data: today's Termine stats/
// list, the practice's real registration QR, and real unread-message
// summaries (lib/unreadTracking.js's per-device marker). "Kontrollpatienten
// fällig" stays a placeholder -- that needs the Impfpass/vaccine-schedule
// subsystem, not built in this app yet.
export default function UebersichtView({ onNavigate }) {
  const [termine, setTermine] = useState([]);
  const [loadingTermine, setLoadingTermine] = useState(true);
  const [unread, setUnread] = useState([]);
  const [loadingUnread, setLoadingUnread] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [practiceName, setPracticeName] = useState('');

  useEffect(() => {
    listTermineForDate(todayStr()).then((list) => {
      setTermine(list);
      setLoadingTermine(false);
    });
    fetchUnreadMessageSummaries(lastViewedFor).then((list) => {
      setUnread(list);
      setLoadingUnread(false);
    });
    fetchPracticeSettings().then((p) => {
      setPracticeName((p && p.name) || '');
      setQrDataUrl(renderQrDataUrl(buildGeneralRegisterUrl(p && p.id)));
    });
  }, []);

  const ausstehend = termine.filter((t) => t.status === 'neu').length;
  const totalUnread = unread.reduce((sum, p) => sum + p.unreadCount, 0);

  function handlePrint() {
    const root = document.getElementById('printAreaGeneral');
    if (!root || !qrDataUrl) return;
    root.querySelector('.print-qr').src = qrDataUrl;
    window.print();
  }

  return (
    <div className="view active">
      <div className="view-header">
        <div className="view-title">Übersicht</div>
        <div className="view-sub">{practiceName ? 'Ordination ' + practiceName + ' · ' : ''}{TODAY_LABEL}</div>
      </div>
      <div className="scroll-content">
        <div className="stats-row">
          <div className="stat-box">
            <div className="stat-num">{termine.length}</div>
            <div className="stat-label">Termine heute</div>
          </div>
          <div className="stat-box">
            <div className="stat-num" style={{ color: 'var(--amber)' }}>{ausstehend}</div>
            <div className="stat-label">Ausstehend</div>
          </div>
          <div className="stat-box">
            <div className="stat-num" style={{ color: 'var(--brand)' }}>{totalUnread}</div>
            <div className="stat-label">Nachrichten</div>
          </div>
        </div>

        <div className="dash-grid-2col">
          <div className="dash-section">
            <div className="section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Heutige Termine</span>
              <span
                style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 600, cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}
                onClick={() => onNavigate && onNavigate('termine')}
              >
                Alle sehen →
              </span>
            </div>
            <div className="card">
              <div className="card-body" style={{ padding: '0 16px' }}>
                {loadingTermine && <div className="empty-placeholder">Lädt...</div>}
                {!loadingTermine && termine.length === 0 && <div className="empty-placeholder">Keine Termine heute</div>}
                {!loadingTermine && termine.slice(0, 5).map((t) => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, width: 40, flexShrink: 0 }}>{t.time}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t.patient}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.art}</div>
                    </div>
                    {STATUS_LABEL[t.status] && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>{STATUS_LABEL[t.status]}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="dash-section">
            <div className="section-title">Patienten einladen</div>
            <div className="qr-card">
              {qrDataUrl ? <img className="qr-img" src={qrDataUrl} alt="Patienten-QR-Code" /> : <div className="qr-img" />}
              <div className="qr-info">
                <div className="qr-title">Patienten-QR-Code</div>
                <div className="qr-sub">Drucken Sie diesen Code aus und geben Sie ihn Ihren Patienten mit — direkt zur Selbstregistrierung fürs Patientenportal.</div>
                <button className="qr-print-btn" type="button" onClick={handlePrint}>
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
                {loadingUnread && <div className="empty-placeholder">Lädt...</div>}
                {!loadingUnread && unread.length === 0 && <div className="empty-placeholder">Keine neuen Nachrichten</div>}
                {!loadingUnread && unread.map((p) => (
                  <div
                    key={p.patientId}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    onClick={() => onNavigate && onNavigate('patienten')}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{p.fullName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.preview}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p.time}</div>
                      <div className="mp-badge">{p.unreadCount}</div>
                    </div>
                  </div>
                ))}
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

      {createPortal(
        <div id="printAreaGeneral">
          <img src="/logo-icon.png" alt="Logo" className="print-logo" />
          <img alt="QR Code" className="print-qr" />
          <div className="print-title">Smartordi.chat</div>
          <div className="print-sub">Scannen Sie diesen Code mit Ihrem Smartphone, um sich für das Patientenportal zu registrieren.</div>
        </div>,
        document.body,
      )}
    </div>
  );
}
