import { useEffect, useState } from 'react';
import { sb } from './lib/supabase';
import { patientGetProfile } from './lib/patientAuth';
import { resolveLogin } from './lib/patientLoginFlow';
import LoginScreen from './LoginScreen';
import RegisterScreen from './RegisterScreen';
import FirstLoginScreen from './FirstLoginScreen';
import RequestStatusScreen from './RequestStatusScreen';
import PatientPortal from './PatientPortal';

// Short deep link into registration, same /patient-register/<practiceId>
// convention secretary.html's own QR code already uses for the vanilla app
// (see its PATIENT_PORTAL_ORIGIN + generalUrl, and this project's own
// vercel.json rewrite) -- so a staff-shared link/QR looks and behaves the
// same regardless of which app it points at. Falls back to the old
// ?practice=<id> query form so an existing link still works.
// practiceRef is whatever the link carries -- a short code (practices.
// short_code, phase89) or, for an older-style shared link, the practice's
// raw UUID. RegisterScreen resolves which one it got.
//
// Also parses the QR temp-credential params secretary.html's "+ Neuer
// Patient"/password-reset QR codes carry (mirrors patient-login.html's
// tryQrLogin(): u=username, t=temp password, nu=1 means "this account
// needs a real username chosen too, not just a password").
function parseUrl() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const m = path.match(/^\/patient-register(?:\/([^/]+))?\/?$/);
  if (m) return { view: 'register', practiceRef: m[1] || params.get('practice') || null };
  if (params.get('practice')) return { view: 'register', practiceRef: params.get('practice') };
  const u = params.get('u'), t = params.get('t');
  if (u && t) return { view: 'qrlogin', qrUsername: u, qrPassword: t, qrNeedsNewUsername: params.get('nu') === '1' };
  return { view: 'login', practiceRef: null };
}

export default function App() {
  const [profile, setProfile] = useState(null);
  const [checking, setChecking] = useState(true);
  const [initial] = useState(parseUrl);
  const [view, setView] = useState(initial.view); // 'login' | 'register' | 'qrlogin' | 'firstlogin' | 'requeststatus'
  const [firstLoginInfo, setFirstLoginInfo] = useState(null); // resolveLogin()'s 'firstlogin' result
  const [requestStatus, setRequestStatus] = useState(null); // { status, note }
  const [loginFallback, setLoginFallback] = useState(null); // prefill + error after a failed QR auto-login

  // If a session already exists (e.g. this browser just logged in through
  // the real patient-login.html), pick it up instead of asking again --
  // same spirit as patient.html's own session check.
  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      if (data.session) {
        const p = await patientGetProfile();
        if (p) { setProfile(p); setChecking(false); return; }
      }
      if (view === 'qrlogin') {
        window.history.replaceState(null, '', window.location.pathname);
        try {
          const result = await resolveLogin(initial.qrUsername, initial.qrPassword, { qrNeedsNewUsername: initial.qrNeedsNewUsername });
          handleResolve(result, { username: initial.qrUsername, password: initial.qrPassword });
        } catch {
          setLoginFallback({ username: initial.qrUsername, password: initial.qrPassword, error: 'Anmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.' });
          setView('login');
        }
      }
      setChecking(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checking) return null;

  async function handleProfileSwitched() {
    const p = await patientGetProfile();
    if (p) setProfile(p);
  }

  function handleResolve(result, fallbackCreds) {
    if (result.kind === 'portal') {
      setProfile(result.profile);
    } else if (result.kind === 'firstlogin') {
      setFirstLoginInfo(result);
      setView('firstlogin');
    } else if (result.kind === 'pending' || result.kind === 'rejected') {
      setRequestStatus({ status: result.kind, note: result.note });
      setView('requeststatus');
    } else {
      // invalid/error -- only reached via the QR auto-login path (a manual
      // LoginScreen submit handles these itself); fall back to the plain
      // login form, prefilled, so the patient at least sees what happened.
      setLoginFallback({ ...fallbackCreds, error: result.message || 'Falscher Benutzername oder Passwort.' });
      setView('login');
    }
  }

  if (profile) {
    return (
      <PatientPortal
        profile={profile}
        onLoggedOut={() => setProfile(null)}
        onProfileSwitched={handleProfileSwitched}
      />
    );
  }

  if (view === 'qrlogin') return null; // auto-login in flight, see the effect above

  if (view === 'firstlogin' && firstLoginInfo) {
    return (
      <FirstLoginScreen
        profile={firstLoginInfo.profile}
        needsUsername={firstLoginInfo.needsUsername}
        needsPassword={firstLoginInfo.needsPassword}
        needsConsent={firstLoginInfo.needsConsent}
        onDone={(updatedProfile) => setProfile(updatedProfile)}
      />
    );
  }

  if (view === 'requeststatus' && requestStatus) {
    return (
      <RequestStatusScreen
        status={requestStatus.status}
        note={requestStatus.note}
        onBackToLogin={() => setView('login')}
        onRegisterAgain={() => setView('register')}
      />
    );
  }

  if (view === 'register') {
    return <RegisterScreen practiceRef={initial.practiceRef} onBackToLogin={() => setView('login')} />;
  }

  return (
    <LoginScreen
      onResolve={handleResolve}
      onRegister={() => setView('register')}
      initialUsername={loginFallback?.username}
      initialPassword={loginFallback?.password}
      initialError={loginFallback?.error}
    />
  );
}
