import { useEffect, useState } from 'react';
import { patientLogout } from './lib/patientAuth';
import {
  patientGetArztRoster, patientGetBookingEnabled, patientGetDocuments,
  patientGetImpfungen, patientGetMessages, patientGetProfiles, patientGetTermine,
  patientGetWorkingHours, patientSendMessage, patientSwitchProfile,
} from './lib/patientData';
import DokumenteTab from './DokumenteTab';
import ImpfpassTab from './ImpfpassTab';
import BookingForm from './BookingForm';
import PasswordChangeForm from './PasswordChangeForm';
import AddProfileForm from './AddProfileForm';

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('de-AT', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function HomeTab({ profile, termine, messages }) {
  const nextTermin = termine.find((t) => t.status !== 'cancelled' && new Date(t.date) >= new Date(new Date().toDateString()));
  const unread = messages.filter((m) => m.dir === 'in').length;
  return (
    <div>
      <div className="welcome-title">Hallo, {profile.name || profile.fullName}!</div>
      <div className="welcome-sub">Ihr Bereich bei {profile.fach ? `Dr. ${profile.fach}` : 'Ihrer Ordination'}.</div>

      <div className="home-card">
        <div className="home-card-label">Nächster Termin</div>
        {nextTermin ? (
          <>
            <div className="home-card-main">{fmtDate(nextTermin.date)} · {nextTermin.time}</div>
            <div className="home-card-sub">{nextTermin.art || 'Ordination'}</div>
          </>
        ) : (
          <div className="home-card-sub">Kein bevorstehender Termin</div>
        )}
      </div>

      <div className="home-card">
        <div className="home-card-label">Nachrichten</div>
        <div className="home-card-main">{unread > 0 ? `${unread} neu` : 'Keine neuen Nachrichten'}</div>
      </div>
    </div>
  );
}

function TermineTab({ termine, loading, arzte, workingHours, bookingEnabled, onBooked }) {
  const [booking, setBooking] = useState(false);

  if (booking) {
    return (
      <BookingForm
        arzte={arzte}
        workingHours={workingHours}
        bookingEnabled={bookingEnabled}
        onCancel={() => setBooking(false)}
        onBooked={() => { setBooking(false); onBooked(); }}
      />
    );
  }

  return (
    <div>
      <button className="btn-main" style={{ width: '100%', marginBottom: 16 }} onClick={() => setBooking(true)}>
        + Termin buchen
      </button>
      {loading ? (
        <div className="empty-state">Lädt…</div>
      ) : termine.length === 0 ? (
        <div className="empty-state">Keine Termine vorhanden.</div>
      ) : (
        <div className="list-col">
          {termine.map((t) => (
            <div className="list-row" key={t.id}>
              <div className="list-row-main">{fmtDate(t.date)}</div>
              <div className="list-row-sub">{t.time}{t.endTime ? ` – ${t.endTime}` : ''} · {t.art || 'Ordination'}</div>
              <span className={`status-pill status-${t.status}`}>{t.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatTab({ messages, loading, onSent }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      await patientSendMessage(text.trim());
      setText('');
      onSent();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-col">
      <div className="chat-messages">
        {loading && <div className="empty-state">Lädt…</div>}
        {!loading && messages.length === 0 && <div className="empty-state">Noch keine Nachrichten.</div>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble chat-${m.dir}`}>
            <div>{m.text}</div>
            <div className="chat-time">{m.time}</div>
          </div>
        ))}
      </div>
      <form className="chat-input-row" onSubmit={handleSend}>
        <input
          className="form-input"
          placeholder="Nachricht schreiben…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn-main" type="submit" disabled={sending}>Senden</button>
      </form>
    </div>
  );
}

function ProfilesSection({ profiles, loading, onSwitch, onAdd }) {
  const [switching, setSwitching] = useState(null);
  const [adding, setAdding] = useState(null); // null | 'child' | 'adult'
  const activeProfile = profiles.find((p) => p.isActive);

  if (adding) {
    return (
      <AddProfileForm
        type={adding}
        practiceId={activeProfile ? activeProfile.practiceId : null}
        onCancel={() => setAdding(null)}
        onDone={() => { setAdding(null); onAdd(); }}
      />
    );
  }

  async function handleSwitch(patientId) {
    setSwitching(patientId);
    try {
      await onSwitch(patientId);
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div className="form-label" style={{ marginBottom: 8 }}>Meine Profile</div>
      {loading ? (
        <div className="empty-state">Lädt…</div>
      ) : (
        <div className="list-col">
          {profiles.map((p) => (
            <button
              key={p.patientId}
              className={`list-row list-row-button${p.isActive ? ' profile-active' : ''}`}
              onClick={() => !p.isActive && handleSwitch(p.patientId)}
              disabled={switching === p.patientId}
            >
              <div className="list-row-main">{p.fullName}{p.isActive ? ' (aktiv)' : ''}</div>
              <div className="list-row-sub">{p.relationLabel || p.relation}</div>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setAdding('child')}>+ Kind</button>
        <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setAdding('adult')}>+ Erwachsene:r</button>
      </div>
    </div>
  );
}

function ProfilTab({ profile, profiles, profilesLoading, onProfileSwitch, onProfilesReload, onLoggedOut }) {
  const [changingPw, setChangingPw] = useState(false);

  if (changingPw) {
    return (
      <PasswordChangeForm
        currentUsername={profile.username}
        onCancel={() => setChangingPw(false)}
        onDone={() => setChangingPw(false)}
      />
    );
  }

  return (
    <div>
      <div className="welcome-row"><span>Benutzername</span><span>{profile.username}</span></div>
      <div className="welcome-row"><span>Versicherung</span><span>{profile.versicherung || '—'}</span></div>
      <div className="welcome-row"><span>Geburtsdatum</span><span>{profile.dob || '—'}</span></div>
      <div className="welcome-row"><span>Adresse</span><span>{profile.adresse || '—'}</span></div>
      <div className="welcome-row"><span>Telefon</span><span>{profile.tel || '—'}</span></div>
      <button className="btn-secondary" style={{ width: '100%', marginTop: 20 }} onClick={() => setChangingPw(true)}>Passwort ändern</button>
      <button className="btn-main" style={{ marginTop: 10 }} onClick={onLoggedOut}>Abmelden</button>

      <ProfilesSection
        profiles={profiles} loading={profilesLoading}
        onSwitch={onProfileSwitch} onAdd={onProfilesReload}
      />
    </div>
  );
}

const TABS = [
  { id: 'home', label: 'Start', icon: '⌂' },
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'termine', label: 'Termine', icon: '📅' },
  { id: 'dokumente', label: 'Befunde', icon: '📄' },
  { id: 'impfpass', label: 'Impfpass', icon: '💉' },
  { id: 'profil', label: 'Profil', icon: '👤' },
];

export default function PatientPortal({ profile, onLoggedOut, onProfileSwitched }) {
  const [tab, setTab] = useState('home');
  const [termine, setTermine] = useState([]);
  const [messages, setMessages] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [impfungen, setImpfungen] = useState([]);
  const [arzte, setArzte] = useState([]);
  const [workingHours, setWorkingHours] = useState(null);
  const [bookingEnabled, setBookingEnabled] = useState(true);
  const [profiles, setProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  async function reload() {
    const [t, m, d, i] = await Promise.all([
      patientGetTermine(), patientGetMessages(), patientGetDocuments(), patientGetImpfungen(),
    ]);
    setTermine(t);
    setMessages(m);
    setDocuments(d);
    setImpfungen(i);
  }

  async function reloadProfiles() {
    setProfilesLoading(true);
    try {
      setProfiles(await patientGetProfiles());
    } finally {
      setProfilesLoading(false);
    }
  }

  useEffect(() => {
    Promise.all([
      reload(),
      reloadProfiles(),
      patientGetArztRoster().then(setArzte),
      patientGetWorkingHours().then(setWorkingHours),
      patientGetBookingEnabled().then(setBookingEnabled),
    ]).finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    await patientLogout();
    onLoggedOut();
  }

  async function handleProfileSwitch(patientId) {
    const ok = await patientSwitchProfile(patientId);
    if (ok) await onProfileSwitched();
  }

  return (
    <div className="portal-card">
      <div className="card-logo">
        <img src="/logo..jpeg" alt="Logo" className="card-logo-img" />
        <div className="card-logo-text">Smartordi<span>.chat</span></div>
      </div>

      <div className="portal-body">
        {tab === 'home' && <HomeTab profile={profile} termine={termine} messages={messages} />}
        {tab === 'termine' && (
          <TermineTab
            termine={termine} loading={loading} arzte={arzte}
            workingHours={workingHours} bookingEnabled={bookingEnabled}
            onBooked={reload}
          />
        )}
        {tab === 'chat' && <ChatTab messages={messages} loading={loading} onSent={reload} />}
        {tab === 'dokumente' && <DokumenteTab documents={documents} loading={loading} />}
        {tab === 'impfpass' && <ImpfpassTab impfungen={impfungen} loading={loading} />}
        {tab === 'profil' && (
          <ProfilTab
            profile={profile} onLoggedOut={handleLogout}
            profiles={profiles} profilesLoading={profilesLoading}
            onProfileSwitch={handleProfileSwitch} onProfilesReload={reloadProfiles}
          />
        )}
      </div>

      <nav className="bottom-nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-item${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="nav-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
