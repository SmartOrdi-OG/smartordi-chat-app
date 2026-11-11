import { useEffect, useState } from 'react';
import { fetchPendingJoinRequests, approveJoinRequest, rejectJoinRequest, relationLabelDe } from './lib/joinRequestsData';
import { fetchPracticeAdminFach } from './lib/staffAuth';
import { showToast } from './lib/toast';

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

// Mirrors secretary.html's #joinRequestsModal + renderJoinRequests()/
// approveJoinRequest()/rejectJoinRequest().
export default function JoinRequestsModal({ onClose, onChanged }) {
  const [list, setList] = useState(null); // null = loading
  const [busyUsername, setBusyUsername] = useState(null);

  function refresh() {
    fetchPendingJoinRequests().then(setList);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleApprove(username) {
    setBusyUsername(username);
    try {
      const fach = await fetchPracticeAdminFach();
      const result = await approveJoinRequest(username, fach);
      if (result.ok) {
        showToast(result.fullName + ' wurde angenommen', 'success');
        onChanged();
      } else {
        showToast(result.error, 'error');
      }
      refresh();
    } finally {
      setBusyUsername(null);
    }
  }

  async function handleReject(username) {
    const note = window.prompt('Grund für die Ablehnung (optional, wird dem/der Patient/in angezeigt):', '') || '';
    if (note === null) return;
    setBusyUsername(username);
    try {
      const result = await rejectJoinRequest(username, note);
      showToast(result.ok ? 'Anfrage von ' + result.fullName + ' abgelehnt' : 'Fehler beim Ablehnen der Anfrage', result.ok ? 'success' : 'error');
      refresh();
    } finally {
      setBusyUsername(null);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg> Beitrittsanfragen
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
            Patient/innen, die sich selbst über die Anmeldeseite registriert haben, ohne vorher in der Ordination gewesen zu sein — hier prüfen und annehmen oder ablehnen.
          </div>
          {list === null && <div className="empty-placeholder">Lädt...</div>}
          {list !== null && list.length === 0 && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 13 }}>Keine offenen Beitrittsanfragen</div>
          )}
          {(list || []).map((r) => (
            <div key={r.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 3px 12px rgba(16,24,29,0.06)', padding: '14px 16px', marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{r.full_name}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#48565f', marginTop: 3 }}>{r.adresse || '—'}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#48565f' }}>SVNr: {r.svnr || '—'} · Benutzername: {r.username}</div>
                  {r.linked_auth_user_id && (
                    <div style={{ display: 'inline-block', marginTop: 4, background: '#EAF4F1', color: '#0E5E56', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6 }}>
                      🔗 {relationLabelDe(r.relation, r.relation_label)} — wird einem bestehenden Zugang hinzugefügt
                    </div>
                  )}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap' }}>{formatDate(r.submitted_at)}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  disabled={busyUsername === r.username}
                  onClick={() => handleApprove(r.username)}
                  style={{ flex: 1, background: '#dcfce7', border: '1px solid #86efac', color: '#15803d', padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><polyline points="20 6 9 17 4 12" /></svg> Annehmen
                </button>
                <button
                  type="button"
                  disabled={busyUsername === r.username}
                  onClick={() => handleReject(r.username)}
                  style={{ flex: 1, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg> Ablehnen
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" type="button" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </div>
  );
}
