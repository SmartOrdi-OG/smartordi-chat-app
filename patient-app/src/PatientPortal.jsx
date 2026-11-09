import { useEffect, useState } from 'react';
import { patientLogout } from './lib/patientAuth';
import { patientGetMessages, patientGetTermine, patientSendMessage } from './lib/patientData';

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

function TermineTab({ termine }) {
  if (termine.length === 0) {
    return <div className="empty-state">Keine Termine vorhanden.</div>;
  }
  return (
    <div className="list-col">
      {termine.map((t) => (
        <div className="list-row" key={t.id}>
          <div className="list-row-main">{fmtDate(t.date)}</div>
          <div className="list-row-sub">{t.time}{t.endTime ? ` – ${t.endTime}` : ''} · {t.art || 'Ordination'}</div>
          <span className={`status-pill status-${t.status}`}>{t.status}</span>
        </div>
      ))}
    </div>
  );
}

function ChatTab({ messages, onSent }) {
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
        {messages.length === 0 && <div className="empty-state">Noch keine Nachrichten.</div>}
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

function ProfilTab({ profile, onLoggedOut }) {
  return (
    <div>
      <div className="welcome-row"><span>Benutzername</span><span>{profile.username}</span></div>
      <div className="welcome-row"><span>Versicherung</span><span>{profile.versicherung || '—'}</span></div>
      <div className="welcome-row"><span>Geburtsdatum</span><span>{profile.dob || '—'}</span></div>
      <div className="welcome-row"><span>Adresse</span><span>{profile.adresse || '—'}</span></div>
      <div className="welcome-row"><span>Telefon</span><span>{profile.tel || '—'}</span></div>
      <button className="btn-main" style={{ marginTop: 20 }} onClick={onLoggedOut}>Abmelden</button>
    </div>
  );
}

const TABS = [
  { id: 'home', label: 'Start', icon: '⌂' },
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'termine', label: 'Termine', icon: '📅' },
  { id: 'profil', label: 'Profil', icon: '👤' },
];

export default function PatientPortal({ profile, onLoggedOut }) {
  const [tab, setTab] = useState('home');
  const [termine, setTermine] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    const [t, m] = await Promise.all([patientGetTermine(), patientGetMessages()]);
    setTermine(t);
    setMessages(m);
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    await patientLogout();
    onLoggedOut();
  }

  return (
    <div className="portal-card">
      <div className="card-logo">
        <img src="/logo..jpeg" alt="Logo" className="card-logo-img" />
        <div className="card-logo-text">Smartordi<span>.chat</span></div>
      </div>

      <div className="portal-body">
        {loading ? (
          <div className="empty-state">Lädt…</div>
        ) : tab === 'home' ? (
          <HomeTab profile={profile} termine={termine} messages={messages} />
        ) : tab === 'termine' ? (
          <TermineTab termine={termine} />
        ) : tab === 'chat' ? (
          <ChatTab messages={messages} onSent={reload} />
        ) : (
          <ProfilTab profile={profile} onLoggedOut={handleLogout} />
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
