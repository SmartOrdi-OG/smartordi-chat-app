import { patientLogout } from './lib/patientAuth';

export default function WelcomeScreen({ profile, onLoggedOut }) {
  async function handleLogout() {
    await patientLogout();
    onLoggedOut();
  }

  return (
    <div className="card">
      <div className="card-logo">
        <img src="/logo..jpeg" alt="Logo" className="card-logo-img" />
        <div className="card-logo-text">
          Smartordi<span>.chat</span>
        </div>
      </div>

      <div className="welcome-title">Willkommen, {profile.name || profile.fullName}!</div>
      <div className="welcome-sub">
        React-Proof-of-Concept — echte Daten direkt aus Supabase, keine neue
        Seite ist noch mit dieser verlinkt.
      </div>

      <div className="welcome-row"><span>Benutzername</span><span>{profile.username}</span></div>
      <div className="welcome-row"><span>Versicherung</span><span>{profile.versicherung || '—'}</span></div>
      <div className="welcome-row"><span>Geburtsdatum</span><span>{profile.dob || '—'}</span></div>

      <button className="btn-main" style={{ marginTop: 20 }} onClick={handleLogout}>
        Abmelden
      </button>
    </div>
  );
}
