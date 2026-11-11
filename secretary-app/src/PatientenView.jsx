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
export default function PatientenView() {
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

  const rows = searchResults !== null ? searchResults : patients;

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
            <div className="patient-search">
              <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg></span>
              <input type="text" placeholder="Name oder SV-Nummer suchen..." value={query} onChange={(e) => onSearchInput(e.target.value)} />
            </div>
          </div>
          <div className="scroll-content" style={{ paddingTop: 0 }}>
            {loadingList && searchResults === null && <div className="empty-placeholder">Lädt...</div>}
            {!loadingList && rows.length === 0 && <div className="empty-placeholder">{searchResults !== null ? 'Keine Treffer' : 'Noch keine Patienten'}</div>}
            {rows.map((p) => <PatientRow key={p.id} p={p} onClick={() => setSelectedPatient(p)} onEdit={setEditPatient} />)}
          </div>
        </div>

        {selectedPatient && (
          <PatientChatPane patient={selectedPatient} onBack={() => setSelectedPatient(null)} onEdit={() => setEditPatient(selectedPatient)} />
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
          onClose={() => { setImportOpen(false); refreshList(); }}
          onImported={refreshList}
        />
      )}
      {docImportOpen && <DocImportModal onClose={() => setDocImportOpen(false)} />}
    </div>
  );
}
