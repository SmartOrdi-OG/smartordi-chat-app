import { useState } from 'react';
import { staffSignIn } from './lib/staffAuth';

// Mirrors login.html's doLogin() form, restyled to secretary-app's own
// design tokens. Any staff account (arzt or sekretaer) can sign in here --
// this app has no server-side role split yet, see App.jsx.
export default function StaffLoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      const result = await staffSignIn(email.trim(), password);
      if (!result.ok) {
        setError(result.error);
        setPassword('');
        return;
      }
      onLoggedIn(result.profile);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="login-card">
        <div className="login-logo">
          <img src="/logo-icon.png" alt="Logo" />
          <div className="login-logo-text">smartordi<span>.chat</span></div>
        </div>

        {error && (
          <div className="error-msg">
            <span>!</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="email">E-Mail</label>
            <input
              id="email"
              className="form-input"
              type="email"
              placeholder="team@praxis.at"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="password">Passwort</label>
            <input
              id="password"
              className="form-input"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn-main" type="submit" disabled={loading}>
            {loading ? <span className="spinner-row"><span className="spinner" /> Einen Moment...</span> : 'Anmelden'}
          </button>
        </form>
      </div>
    </div>
  );
}
