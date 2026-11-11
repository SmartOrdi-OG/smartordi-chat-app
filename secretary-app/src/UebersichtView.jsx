import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { fetchPracticeSettings } from './lib/staffAuth';
import { listTermineForDate } from './lib/termineData';
import { fetchUnreadMessageSummaries, buildGeneralRegisterUrl, listPatients, sendMessageToPatient } from './lib/patientsData';
import { lastViewedFor } from './lib/unreadTracking';
import { renderQrDataUrl } from './lib/qr';
import { computeRecallList, buildRecallReminderText } from './lib/followupReminders';
import { colorForName } from './lib/avatarColor';
import { showToast } from './lib/toast';

function todayStr() {
  return new Date().toISOString().split('T')[0];
}
const TODAY_LABEL = new Date().toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const STATUS_LABEL = { bestaetigt: 'Bestätigt', abgesagt: 'Abgesagt', nicht_erschienen: 'Nicht erschienen' };

// Mirrors secretary.html's #view-uebersicht -- Phase 1 built the layout
// with mock numbers, Phase 7 wired up real data for Termine/QR/unread
// messages. Phase 17 adds "Kontrollpatienten fällig" -- a chronic-
// condition follow-up worklist (lib/followupReminders.js), not the
// Impfpass/vaccine-schedule subsystem (a different, still-unbuilt
// feature despite the similar-sounding name -- see that file's own
// comment).
export default function UebersichtView({ onNavigate }) {
  const [termine, setTermine] = useState([]);
  const [loadingTermine, setLoadingTermine] = useState(true);
  const [unread, setUnread] = useState([]);
  const [loadingUnread, setLoadingUnread] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [practiceName, setPracticeName] = useState('');
  const [recallList, setRecallList] = useState([]);
  const [loadingRecall, setLoadingRecall] = useState(true);

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
    listPatients().then((patients) => computeRecallList(patients)).then((list) => {
      setRecallList(list);
      setLoadingRecall(false);
    });
  }, []);

  async function handleRemind(entry) {
    const text = buildRecallReminderText(entry.name, entry.label, entry.monthsSince);
    try {
      await sendMessageToPatient(entry.patientId, text);
      showToast('Erinnerung per Chat gesendet', 'success');
    } catch {
      showToast('Senden fehlgeschlagen', 'error');
    }
  }

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
                {loadingRecall && <div className="empty-placeholder">Lädt...</div>}
                {!loadingRecall && recallList.length === 0 && <div className="empty-placeholder">Keine fälligen Kontrollpatienten</div>}
                {!loadingRecall && recallList.map((e) => (
                  <div
                    key={e.patientId}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    onClick={() => onNavigate && onNavigate('patienten')}
                  >
                    <div className="avatar" style={{ width: 34, height: 34, fontSize: 13, background: colorForName(e.name), flexShrink: 0 }}>{e.name[0]}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{e.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {e.label} · seit {e.monthsSince} Monaten (empfohlen: alle {e.thresholdMonths})
                      </div>
                    </div>
                    <button
                      type="button" onClick={(ev) => { ev.stopPropagation(); handleRemind(e); }}
                      style={{ border: 'none', background: '#EAF4F1', color: '#0E5E56', fontSize: 11, fontWeight: 700, padding: '6px 10px', borderRadius: 8, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
                    >
                      🔔 Erinnern
                    </button>
                  </div>
                ))}
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
