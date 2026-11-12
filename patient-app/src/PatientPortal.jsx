import { useEffect, useState } from 'react';
import { useLanguage } from './LanguageContext';
import { renderSystemMessage, localizedDate, monthsShort, dayLabels } from './lib/i18n';
import { patientLogout } from './lib/patientAuth';
import {
  patientGetArztRoster, patientGetBookingEnabled, patientGetDocuments,
  patientGetImpfungen, patientGetMessages, patientGetMkpExams, patientGetProfiles,
  patientGetTermine, patientGetWorkingHours, patientSendMessage, patientSwitchProfile,
} from './lib/patientData';
import DokumenteTab from './DokumenteTab';
import ImpfpassTab from './ImpfpassTab';
import BookingForm from './BookingForm';
import PasswordChangeForm from './PasswordChangeForm';
import AddProfileForm from './AddProfileForm';
import MkpTab from './MkpTab';
import Calendar from './Calendar';
import SymptomPickerModal from './SymptomPickerModal';
import { artNeedsSymptomPicker } from './lib/symptomRegions';

// Renders a chat message in the patient's CURRENTLY selected language --
// mirrors patient.html's msgRowHtml(): a FIXED/system message (Termin
// confirmed/moved/cancelled, Vertretung/address-change, doctor transfer)
// carries msgKey/msgParams (supabase/phase83_patient_message_translations.sql,
// written by secretary-app since Phase 22), re-rendered here at display
// time; every other message (the patient's own, or staff free-text) has no
// msgKey and just shows its stored `text` as-is, same as before.
function renderMessageText(m) {
  if (!m.msgKey) return m.text;
  try { return renderSystemMessage(m.msgKey, m.msgParams || {}); }
  catch { return m.text; }
}

// Mirrors the day-label table dayLabels() itself already provides for the
// calendar grid (Monday-start) -- used here instead of
// toLocaleDateString(..., {weekday:'short'}), which only ever renders the
// GERMAN weekday abbreviation (a fixed 'de-AT' locale) regardless of which
// language the patient has chosen.
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  const dow = dayLabels()[(d.getDay() + 6) % 7];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dow}., ${dd}.${mm}.${d.getFullYear()}`;
}

const ICONS = {
  home: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>,
  termine: <><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
  dokumente: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
  impfpass: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M12 8v6"/><path d="M9 11h6"/></>,
  mkp: <><path d="M9 12h6M12 9v6"/><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 2v4M16 2v4"/></>,
  profil: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
};

function NavIcon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

function HomeTab({ profile, termine, messages }) {
  const { t, tp } = useLanguage();
  const nextTermin = termine.find((t) => t.status !== 'cancelled' && new Date(t.date) >= new Date(new Date().toDateString()));
  const unread = messages.filter((m) => m.dir === 'in').length;
  return (
    <div className="view-content">
      <div className="home-greeting-name">{tp('home.greeting', { name: profile.name || profile.fullName })}</div>
      <div className="home-greeting-sub">{tp('home.areaAt', { doctor: profile.fach ? `Dr. ${profile.fach}` : t('home.yourPractice') })}</div>

      <div className="home-card">
        <div className="home-card-label">{t('home.nextTermin')}</div>
        {nextTermin ? (
          <>
            <div className="home-card-main">{fmtDate(nextTermin.date)} · {nextTermin.time}</div>
            <div className="home-card-sub">{nextTermin.art || t('termine.art.ordination')}</div>
          </>
        ) : (
          <div className="home-card-sub">{t('termine.noUpcoming')}</div>
        )}
      </div>

      <div className="home-card">
        <div className="home-card-label">{t('home.messages')}</div>
        <div className="home-card-main">{unread > 0 ? tp('home.newMessagesCount', { count: unread }) : t('home.noNewMessages')}</div>
      </div>
    </div>
  );
}

const TERMIN_STATUS_KEY = { bestaetigt: 'confirmed', abgesagt: 'cancelled', neu: 'pending' };

function TermineTab({ termine, loading, arzte, workingHours, bookingEnabled, profile, onBooked }) {
  const { t } = useLanguage();
  const [selectedDate, setSelectedDate] = useState(null);
  const [symptomTerminId, setSymptomTerminId] = useState(null);
  const todayKey = new Date().toDateString();
  const upcoming = termine.filter((t) => t.status !== 'cancelled' && new Date(t.date) >= new Date(todayKey));
  const past = termine.filter((t) => t.status === 'cancelled' || new Date(t.date) < new Date(todayKey));

  async function handleBooked(termin) {
    setSelectedDate(null);
    await onBooked();
    if (artNeedsSymptomPicker(termin.art)) setSymptomTerminId(termin.id);
  }

  function TerminCard({ t: termin }) {
    const d = new Date(termin.date + 'T00:00:00');
    const statusKey = TERMIN_STATUS_KEY[termin.status];
    return (
      <div className="termin-card" key={termin.id}>
        <div className="termin-date-box">
          <div className="termin-day">{d.getDate()}</div>
          <div className="termin-month">{monthsShort()[d.getMonth()]}</div>
        </div>
        <div className="termin-info">
          <div className="termin-title">{termin.art || t('termine.art.ordination')}</div>
          <div className="termin-sub">{termin.time}{termin.endTime ? ` – ${termin.endTime}` : ''}</div>
        </div>
        <span className={`termin-status status-${termin.status}`}>{statusKey ? t('termine.status.' + statusKey) : termin.status}</span>
      </div>
    );
  }

  return (
    <div className="view-content">
      <Calendar
        workingHours={workingHours} termine={termine}
        selectedDate={selectedDate} onSelectDate={setSelectedDate}
      />

      {bookingEnabled ? (
        <div className="booking-card">
          <div className="booking-card-title">{t('termine.bookTitle')}</div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 12 }}>
            {selectedDate ? localizedDate(selectedDate) : t('termine.chooseDay')}
          </div>
          <BookingForm arzte={arzte} workingHours={workingHours} selectedDate={selectedDate} onBooked={handleBooked} />
        </div>
      ) : (
        <div className="booking-card">
          <div className="booking-card-title">{t('termine.bookTitle')}</div>
          <div style={{ fontSize: 12.5, opacity: 0.85 }}>{t('termine.bookingDisabled')}. {t('termine.bookingDisabledSub')}</div>
        </div>
      )}

      <div className="section-title">{t('termine.upcoming')}</div>
      {loading ? (
        <div className="empty-state">{t('common.loading')}</div>
      ) : upcoming.length === 0 ? (
        <div className="empty-state">{t('termine.noUpcoming')}</div>
      ) : (
        upcoming.map((termin) => <TerminCard t={termin} key={termin.id} />)
      )}

      <div className="section-title" style={{ marginTop: 16 }}>{t('termine.past')}</div>
      {!loading && past.length === 0 ? (
        <div className="empty-state">{t('termine.noPast')}</div>
      ) : (
        past.map((termin) => <TerminCard t={termin} key={termin.id} />)
      )}

      {symptomTerminId && (
        <SymptomPickerModal
          terminId={symptomTerminId}
          isChild={!!profile.isChild}
          geschlecht={profile.geschlecht}
          onClose={() => setSymptomTerminId(null)}
          onSaved={async () => { setSymptomTerminId(null); await onBooked(); }}
        />
      )}
    </div>
  );
}

function ChatTab({ messages, loading, onSent, doctor }) {
  const { t } = useLanguage();
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

  const initial = (doctor?.fullName || 'S').trim().charAt(0).toUpperCase();

  return (
    <div className="chat-view">
      <div className="chat-header">
        <div className="chat-header-avatar">{initial}</div>
        <div className="chat-header-info">
          <div className="chat-doctor-name">{doctor?.fullName || 'Ihre Ordination'}</div>
          <div className="chat-doctor-sub">{doctor?.fach || 'Allgemeinmedizin'}</div>
        </div>
      </div>

      <div className="messages">
        {loading && <div className="empty-state">{t('common.loading')}</div>}
        {!loading && messages.length === 0 && <div className="empty-state">{t('chat.empty.title')}</div>}
        {messages.map((m, i) => (
          <div key={i} className={`msg-row ${m.dir === 'out' ? 'out' : ''}`}>
            <div className="msg-bubble">
              <div>{renderMessageText(m)}</div>
              <div className="msg-time">{m.time}</div>
            </div>
          </div>
        ))}
      </div>
      <form className="chat-input-area" onSubmit={handleSend}>
        <div className="chat-input-wrap">
          <input
            className="chat-input"
            placeholder={t('chat.placeholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <button className="send-btn" type="submit" disabled={sending}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </form>
    </div>
  );
}

function ProfilesSection({ profiles, loading, onSwitch, onAdd }) {
  const { t } = useLanguage();
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
    <div className="info-card">
      <div className="info-card-header">{t('profiles.title')}</div>
      <div style={{ padding: 12 }}>
        {loading ? (
          <div className="empty-state">{t('common.loading')}</div>
        ) : (
          profiles.map((p) => (
            <button
              key={p.patientId}
              className={`profile-row${p.isActive ? ' profile-active' : ''}`}
              onClick={() => !p.isActive && handleSwitch(p.patientId)}
              disabled={switching === p.patientId}
            >
              <div className="profile-row-main">{p.fullName}{p.isActive ? ` (${t('profiles.active')})` : ''}</div>
              <div className="profile-row-sub">{p.relationLabel || p.relation}</div>
            </button>
          ))
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setAdding('child')}>{t('profiles.addChild')}</button>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setAdding('adult')}>{t('profiles.addAdult')}</button>
        </div>
      </div>
    </div>
  );
}

function ProfilTab({ profile, profiles, profilesLoading, onProfileSwitch, onProfilesReload, onLoggedOut }) {
  const { t, lang, setLanguage, languages } = useLanguage();
  const [changingPw, setChangingPw] = useState(false);

  if (changingPw) {
    return (
      <div className="view-content">
        <PasswordChangeForm
          currentUsername={profile.username}
          onCancel={() => setChangingPw(false)}
          onDone={() => setChangingPw(false)}
        />
      </div>
    );
  }

  const initial = (profile.name || profile.fullName || 'P').trim().charAt(0).toUpperCase();

  return (
    <div className="view-content">
      <div className="profil-header-card">
        <div className="profil-avatar-lg">{initial}</div>
        <div>
          <div className="profil-name">{profile.name || profile.fullName}</div>
          <div className="profil-sub">@{profile.username}</div>
        </div>
      </div>

      <div className="info-card">
        <div className="info-card-header">{t('profil.persoenlich')}</div>
        <div className="info-row"><span className="info-label">{t('profil.versicherung')}</span><span className="info-value">{profile.versicherung || '—'}</span></div>
        <div className="info-row"><span className="info-label">{t('profil.dob')}</span><span className="info-value">{profile.dob || '—'}</span></div>
        <div className="info-row"><span className="info-label">{t('profil.adresse')}</span><span className="info-value">{profile.adresse || '—'}</span></div>
        <div className="info-row"><span className="info-label">{t('profil.tel')}</span><span className="info-value">{profile.tel || '—'}</span></div>
        <div className="info-row">
          <span className="info-label">{t('profil.language')}</span>
          <select
            className="info-value" value={lang} onChange={(e) => setLanguage(e.target.value)}
            style={{ fontFamily: 'inherit', fontSize: 11, fontWeight: 600, border: '1px solid #e2e8f0', borderRadius: 7, padding: '4px 6px', background: 'white', color: '#334155', cursor: 'pointer', width: 'auto', flexShrink: 0 }}
          >
            {languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
      </div>

      <ProfilesSection
        profiles={profiles} loading={profilesLoading}
        onSwitch={onProfileSwitch} onAdd={onProfilesReload}
      />

      <button className="logout-btn secondary" onClick={() => setChangingPw(true)}>{t('changepw2.button')}</button>
      <button className="logout-btn" onClick={onLoggedOut}>{t('topbar.logout')}</button>
    </div>
  );
}

// MKP's own nav-tab label stays the literal "MKP" abbreviation in every
// language -- mirrors mkp.title ('Mutter-Kind-Pass'), which vendor/
// i18n-patient.js itself deliberately leaves untranslated in all 5
// languages too (it's a specific Austrian government program name, not a
// generic phrase).
function baseTabs(isChild, t) {
  const tabs = [
    { id: 'home', label: t('nav.home'), icon: 'home' },
    { id: 'chat', label: t('nav.chat'), icon: 'chat' },
    { id: 'termine', label: t('nav.termine'), icon: 'termine' },
    { id: 'dokumente', label: t('nav.befunde'), icon: 'dokumente' },
    { id: 'impfpass', label: t('nav.impfpassShort'), icon: 'impfpass' },
  ];
  // Mutter-Kind-Pass is pediatric-only, same as patient.html's own
  // updateMkpTileVisibility() -- there's nothing to show for an adult.
  if (isChild) tabs.push({ id: 'mkp', label: 'MKP', icon: 'mkp' });
  tabs.push({ id: 'profil', label: t('nav.profil'), icon: 'profil' });
  return tabs;
}

export default function PatientPortal({ profile, onLoggedOut, onProfileSwitched }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState('home');
  const [termine, setTermine] = useState([]);
  const [messages, setMessages] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [impfungen, setImpfungen] = useState([]);
  const [mkpExams, setMkpExams] = useState([]);
  const [arzte, setArzte] = useState([]);
  const [workingHours, setWorkingHours] = useState(null);
  const [bookingEnabled, setBookingEnabled] = useState(true);
  const [profiles, setProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const TABS = baseTabs(profile.isChild, t);

  async function reload() {
    const [t, m, d, i, mk] = await Promise.all([
      patientGetTermine(), patientGetMessages(), patientGetDocuments(), patientGetImpfungen(),
      profile.isChild ? patientGetMkpExams() : Promise.resolve([]),
    ]);
    setTermine(t);
    setMessages(m);
    setDocuments(d);
    setImpfungen(i);
    setMkpExams(mk);
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
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar-logo">
          <div className="topbar-icon"><img src="/logo..jpeg" alt="Logo" /></div>
          <div className="topbar-name">Smartordi<span>.chat</span></div>
        </div>
        <div className="topbar-user">
          <div className="topbar-username">{profile.name || profile.fullName}</div>
          <button className="topbar-logout" onClick={handleLogout}>{t('topbar.logout')}</button>
        </div>
      </div>

      <div className="views">
        {tab === 'home' && <HomeTab profile={profile} termine={termine} messages={messages} />}
        {tab === 'termine' && (
          <>
            <div className="view-header">
              <div className="view-title">{t('termine.title')}</div>
              <div className="view-sub">{profile.fach ? `Dr. ${profile.fach}` : t('home.yourPractice')}</div>
            </div>
            <TermineTab
              termine={termine} loading={loading} arzte={arzte}
              workingHours={workingHours} bookingEnabled={bookingEnabled}
              profile={profile} onBooked={reload}
            />
          </>
        )}
        {tab === 'chat' && <ChatTab messages={messages} loading={loading} onSent={reload} doctor={arzte[0]} />}
        {tab === 'dokumente' && (
          <>
            <div className="view-header">
              <div className="view-title">{t('dokumente.title')}</div>
              <div className="view-sub">{t('dokumente.sub')}</div>
            </div>
            <div className="view-content"><DokumenteTab documents={documents} loading={loading} /></div>
          </>
        )}
        {tab === 'impfpass' && (
          <>
            <div className="view-header">
              <div className="view-title">{t('impfungen.title')}</div>
              <div className="view-sub">{t('impfungen.sub')}</div>
            </div>
            <div className="view-content"><ImpfpassTab impfungen={impfungen} loading={loading} /></div>
          </>
        )}
        {tab === 'mkp' && (
          <>
            <div className="view-header">
              <div className="view-title">{t('mkp.title')}</div>
              <div className="view-sub">{t('mkp.sub')}</div>
            </div>
            <div className="view-content"><MkpTab exams={mkpExams} loading={loading} /></div>
          </>
        )}
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
            <span className="nav-icon"><NavIcon name={t.icon} /></span>
            <span className="nav-label">{t.label}</span>
          </button>
        ))}
      </nav>

      <nav className="sidebar-nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`sidebar-nav-item${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="sidebar-nav-icon"><NavIcon name={t.icon} /></span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
