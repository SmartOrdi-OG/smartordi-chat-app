import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import NewPatientModal from './NewPatientModal';
import QrCodeModal from './QrCodeModal';
import PatientCredentialsModal from './PatientCredentialsModal';
import PatientChatPane from './PatientChatPane';
import JoinRequestsModal from './JoinRequestsModal';
import PatientDetailModal from './PatientDetailModal';
import ImportPatientsModal from './ImportPatientsModal';
import DocImportModal from './DocImportModal';
import { listPatients, searchPatients } from './lib/patientsData';
import { fetchPendingJoinRequests } from './lib/joinRequestsData';
import { colorForName } from './lib/avatarColor';

function PatientRow({ p, onClick, onEdit }) {
  const name = p.fullName || p.name || '?';
  const metaParts = [p.versicherung, p.svnr ? 'SV: ' + p.svnr : null].filter(Boolean);
  return (
    <div className="patient-row" onClick={onClick}>
      <div className="avatar" style={{ background: colorForName(name) }}>{name[0]}</div>
      <div className="p-info">
        <div className="p-name">{name}</div>
        <div className="p-meta">{metaParts.join(' · ') || '—'}</div>
      </div>
      <button className="p-action" type="button" onClick={(e) => { e.stopPropagation(); onEdit(p); }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
      </button>
    </div>
  );
}

// Phase 1 built the header/actions menu shell. Phase 2 wired up "Neuer
// Patient"/"QR-Code". Phase 3 added the real patient list + chat. Phase 4
// added "Beitrittsanfragen". Phase 10 added "Patienten importieren" (CSV
// bulk import). Phase 11 adds "Dokumente importieren" (ZIP + manifest CSV
// -> patient_documents, attaches files to existing patients only).
export default function PatientenView({ profile }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [newPatientOpen, setNewPatientOpen] = useState(false);
  const [qrPickerOpen, setQrPickerOpen] = useState(false);
  const [joinRequestsOpen, setJoinRequestsOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [cred, setCred] = useState(null);

  const [patients, setPatients] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [editPatient, setEditPatient] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [docImportOpen, setDocImportOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [advSvnr, setAdvSvnr] = useState('');
  const [advDob, setAdvDob] = useState('');
  const [advVers, setAdvVers] = useState('');
  const searchTimer = useRef(null);

  function refreshList() {
    setLoadingList(true);
    listPatients().then((list) => {
      setPatients(list);
      setLoadingList(false);
    });
  }

  function refreshPendingCount() {
    fetchPendingJoinRequests().then((list) => setPendingCount(list.length));
  }

  useEffect(() => {
    refreshList();
    refreshPendingCount();
  }, []);

  function onSearchInput(value) {
    setQuery(value);
    clearTimeout(searchTimer.current);
    const q = value.trim();
    if (!q) { setSearchResults(null); return; }
    searchTimer.current = setTimeout(async () => {
      setSearchResults(await searchPatients(q, 50));
    }, 250);
  }

  function clearAdvSearch() {
    setAdvSvnr(''); setAdvDob(''); setAdvVers('');
  }

  // Mirrors secAdvSearch() -- narrows whatever's currently shown (the full
  // list OR an already name/SV-Nr-searched result) by matching the same
  // SV-Nummer/Versicherung text a PatientRow itself renders (.p-meta).
  // Geburtsdatum is kept in the panel for parity with the original's own
  // layout, but -- same as secAdvSearch() -- it was never actually wired
  // into the match there either, so it stays a no-op filter here too.
  const svnrQuery = advSvnr.trim().toLowerCase();
  const versQuery = advVers.trim().toLowerCase();
  const baseRows = searchResults !== null ? searchResults : patients;
  const rows = (!svnrQuery && !versQuery) ? baseRows : baseRows.filter((p) => {
    const meta = [p.versicherung, p.svnr ? 'SV: ' + p.svnr : null].filter(Boolean).join(' · ').toLowerCase();
    return (!svnrQuery || meta.includes(svnrQuery)) && (!versQuery || meta.includes(versQuery));
  });

  return (
    <div className="view active">
      <div className="view-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div>
            <div className="view-title">Patienten</div>
            <div className="view-sub">Stammdaten &amp; Chat</div>
          </div>
          <button className="patient-actions-toggle" type="button" onClick={() => setMenuOpen((v) => !v)}>
            <Icon name="menu" size={15} /> Aktionen
            {pendingCount > 0 && <span className="mp-badge" style={{ position: 'absolute', top: -6, right: -6, background: '#dc2626' }}>{pendingCount}</span>}
          </button>
          <div className={`patient-actions-menu${menuOpen ? ' show' : ''}`}>
            <button className="rail-btn rail-btn-cyan" type="button" style={{ position: 'relative' }} onClick={() => { setMenuOpen(false); setJoinRequestsOpen(true); }}>
              <span className="rail-btn-icon"><Icon name="joinRequests" /></span> Beitrittsanfragen
              {pendingCount > 0 && <span className="mp-badge" style={{ position: 'absolute', top: 8, right: 10, background: '#dc2626' }}>{pendingCount}</span>}
            </button>
            <button className="rail-btn" type="button" onClick={() => { setMenuOpen(false); setImportOpen(true); }}>
              <span className="rail-btn-icon"><Icon name="importUp" /></span> Patienten importieren
            </button>
            <button className="rail-btn" type="button" onClick={() => { setMenuOpen(false); setDocImportOpen(true); }}>
              <span className="rail-btn-icon"><Icon name="docImport" /></span> Dokumente importieren
            </button>
            <button className="rail-btn" type="button" onClick={() => { setMenuOpen(false); setQrPickerOpen(true); }}>
              <span className="rail-btn-icon"><Icon name="qr" /></span> QR-Code
            </button>
            <div className="rail-divider" />
            <button className="rail-btn rail-btn-primary" type="button" onClick={() => { setMenuOpen(false); setNewPatientOpen(true); }}>
              <span className="rail-btn-icon"><Icon name="personPlus" /></span> Neuer Patient
            </button>
          </div>
        </div>
      </div>

      <div className={`nachrichten-split${selectedPatient ? ' chat-open' : ''}`}>
        <div className="nachrichten-list-pane">
          <div style={{ padding: '16px 16px 0' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 0 }}>
              <div className="patient-search" style={{ flex: 1, marginBottom: 0 }}>
                <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg></span>
                <input type="text" placeholder="Name oder SV-Nummer suchen..." value={query} onChange={(e) => onSearchInput(e.target.value)} />
              </div>
              <button
                type="button" onClick={() => setAdvOpen((v) => !v)}
                style={{ background: '#EAF4F1', border: '1px solid #bfdbfe', borderRadius: 10, padding: '0 12px', fontSize: 12, fontWeight: 700, color: '#0E5E56', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >Filter</button>
            </div>
            {advOpen && (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 3px 12px rgba(16,24,29,0.06)', padding: '14px 16px', margin: '10px 0 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, fontWeight: 600, color: '#0E5E56', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Erweiterte Suche</div>
                  <button type="button" onClick={clearAdvSearch} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Zurücksetzen</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9.5, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.02em', marginBottom: 4 }}>SV-NUMMER</div>
                    <input
                      value={advSvnr} onChange={(e) => setAdvSvnr(e.target.value)} placeholder="XXXX TTMMJJ..."
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', outline: 'none', background: '#f8fafc' }}
                    />
                  </div>
                  <div>
                    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9.5, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.02em', marginBottom: 4 }}>GEBURTSDATUM</div>
                    <input
                      type="date" value={advDob} onChange={(e) => setAdvDob(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', outline: 'none', background: '#f8fafc' }}
                    />
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9.5, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.02em', marginBottom: 4 }}>VERSICHERUNG</div>
                  <select
                    value={advVers} onChange={(e) => setAdvVers(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', outline: 'none', background: '#f8fafc' }}
                  >
                    <option value="">Alle</option>
                    <option>ÖGK</option>
                    <option>BVAEB</option>
                    <option>SVS</option>
                    <option>KFA</option>
                  </select>
                </div>
              </div>
            )}
          </div>
          <div className="scroll-content" style={{ paddingTop: 0 }}>
            {loadingList && searchResults === null && <div className="empty-placeholder">Lädt...</div>}
            {!loadingList && rows.length === 0 && <div className="empty-placeholder">{(searchResults !== null || svnrQuery || versQuery) ? 'Keine Treffer' : 'Noch keine Patienten'}</div>}
            {rows.map((p) => <PatientRow key={p.id} p={p} onClick={() => setSelectedPatient(p)} onEdit={setEditPatient} />)}
          </div>
        </div>

        {selectedPatient && (
          <PatientChatPane patient={selectedPatient} profile={profile} onBack={() => setSelectedPatient(null)} onEdit={() => setEditPatient(selectedPatient)} />
        )}
      </div>

      {newPatientOpen && (
        <NewPatientModal
          onClose={() => setNewPatientOpen(false)}
          onCreated={(c) => { setNewPatientOpen(false); setCred(c); refreshList(); }}
        />
      )}
      {qrPickerOpen && (
        <QrCodeModal
          onClose={() => setQrPickerOpen(false)}
          onCredentials={(c) => { setQrPickerOpen(false); setCred(c); }}
        />
      )}
      {cred && <PatientCredentialsModal cred={cred} onClose={() => setCred(null)} />}
      {joinRequestsOpen && (
        <JoinRequestsModal
          onClose={() => { setJoinRequestsOpen(false); refreshPendingCount(); }}
          onChanged={() => { refreshList(); refreshPendingCount(); }}
        />
      )}
      {editPatient && (
        <PatientDetailModal
          patient={editPatient}
          onClose={() => setEditPatient(null)}
          onSaved={() => { setEditPatient(null); refreshList(); }}
        />
      )}
      {importOpen && (
        <ImportPatientsModal
          profile={profile}
          onClose={() => { setImportOpen(false); refreshList(); }}
          onImported={refreshList}
        />
      )}
      {docImportOpen && <DocImportModal onClose={() => setDocImportOpen(false)} />}
    </div>
  );
}
