import { useEffect, useState } from 'react';
import { Icon } from './icons';
import UebersichtView from './UebersichtView';
import TermineView from './TermineView';
import PatientenView from './PatientenView';
import StaffLoginScreen from './StaffLoginScreen';
import Toast from './Toast';
import { restoreStaffSession, staffSignOut, fetchPracticeSettings } from './lib/staffAuth';

const TABS = [
  { key: 'uebersicht', label: 'Übersicht', icon: 'uebersicht' },
  { key: 'termine', label: 'Termine', icon: 'termine', badge: 3 },
  { key: 'patienten', label: 'Patienten', icon: 'patienten' },
];

const TODAY_LABEL = new Date().toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// Phase 1 of the secretary.html -> React port: the visual shell only
// (topbar, bottom-nav/sidebar-nav, the three views' layout). Phase 2 adds a
// real session on top of it: StaffLoginScreen (real Supabase Auth) gates the
// shell, and the topbar now shows the real signed-in staff member/practice
// instead of a hardcoded mock.
export default function App() {
  const [view, setView] = useState('uebersicht');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profile, setProfile] = useState(undefined); // undefined = still checking, null = logged out
  const [practiceName, setPracticeName] = useState('');

  useEffect(() => {
    restoreStaffSession().then(setProfile);
  }, []);

  useEffect(() => {
    if (!profile) return;
    fetchPracticeSettings().then((p) => setPracticeName((p && p.name) || ''));
  }, [profile]);

  async function handleLogout() {
    setUserMenuOpen(false);
    await staffSignOut();
    setProfile(null);
    setPracticeName('');
  }

  if (profile === undefined) return null;
  if (!profile) return (
    <div className="auth-shell">
      <StaffLoginScreen onLoggedIn={setProfile} />
      <Toast />
    </div>
  );

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar-logo">
          <img src="/logo-icon.png" alt="Logo" />
          <div>
            <div className="topbar-name">smartordi.chat <span className="topbar-badge">Sekretariat</span></div>
            <div className="topbar-practice-name">{practiceName}</div>
          </div>
        </div>
        <span className="topbar-date">{TODAY_LABEL}</span>
        <div className="topbar-user-menu">
          <button className="topbar-right" type="button" onClick={() => setUserMenuOpen((v) => !v)}>
            <span className="topbar-user-dot" />
            <div className="topbar-uname">{profile.fullName}</div>
            <span className="topbar-user-chev"><Icon name="chevDown" size={12} /></span>
          </button>
          <div className={`topbar-user-dropdown${userMenuOpen ? ' show' : ''}`}>
            <button className="topbar-user-dropdown-item" type="button" onClick={handleLogout}>
              <Icon name="logout" size={13} />
              Abmelden
            </button>
          </div>
        </div>
      </div>

      <div className="app-nav-bar">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`nav-tab${view === tab.key ? ' active' : ''}`}
            type="button"
            onClick={() => setView(tab.key)}
          >
            <span className="nav-tab-icon"><Icon name={tab.icon} size={34} /></span>
            <span>{tab.label}{tab.badge ? <span className="nav-tab-badge">{tab.badge}</span> : null}</span>
          </button>
        ))}
      </div>

      <div className="views">
        {view === 'uebersicht' && <UebersichtView onNavigate={setView} />}
        {view === 'termine' && <TermineView />}
        {view === 'patienten' && <PatientenView profile={profile} />}
      </div>

      <div className="bottom-nav">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`nav-item${view === tab.key ? ' active' : ''}`}
            type="button"
            onClick={() => setView(tab.key)}
          >
            <span className="nav-icon"><Icon name={tab.icon} size={20} /></span>
            <span>{tab.label}</span>
            {tab.badge ? <span className="nav-badge">{tab.badge}</span> : null}
          </button>
        ))}
      </div>
      <Toast />
    </div>
  );
}
