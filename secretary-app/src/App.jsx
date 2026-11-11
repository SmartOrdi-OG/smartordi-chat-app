import { useState } from 'react';
import { Icon } from './icons';
import UebersichtView from './UebersichtView';
import TermineView from './TermineView';
import PatientenView from './PatientenView';

const TABS = [
  { key: 'uebersicht', label: 'Übersicht', icon: 'uebersicht' },
  { key: 'termine', label: 'Termine', icon: 'termine', badge: 3 },
  { key: 'patienten', label: 'Patienten', icon: 'patienten' },
];

// Phase 1 of the secretary.html -> React port: the visual shell only
// (topbar, bottom-nav/sidebar-nav, the three views' layout) with mock
// data -- no login, no real Supabase wiring, no modals yet. Mirrors
// patient-app's own App.jsx/PatientPortal.jsx pattern (single top-level
// view-switch state, feather-style inline icons) for consistency across
// both React ports.
export default function App() {
  const [view, setView] = useState('uebersicht');
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar-logo">
          <img src="/logo-icon.png" alt="Logo" />
          <div>
            <div className="topbar-name">smartordi.chat <span className="topbar-badge">Sekretariat</span></div>
            <div className="topbar-practice-name">Pilot-Praxis Dr. Saadat Alina</div>
          </div>
        </div>
        <span className="topbar-date">Dienstag, 10. November 2026</span>
        <div className="topbar-user-menu">
          <button className="topbar-right" type="button" onClick={() => setUserMenuOpen((v) => !v)}>
            <span className="topbar-user-dot" />
            <div className="topbar-uname">Ahmad Team</div>
            <span className="topbar-user-chev"><Icon name="chevDown" size={12} /></span>
          </button>
          <div className={`topbar-user-dropdown${userMenuOpen ? ' show' : ''}`}>
            <button className="topbar-user-dropdown-item" type="button">
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
        {view === 'uebersicht' && <UebersichtView />}
        {view === 'termine' && <TermineView />}
        {view === 'patienten' && <PatientenView />}
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
    </div>
  );
}
