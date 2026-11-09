import { useEffect, useState } from 'react';
import { sb } from './lib/supabase';
import { patientGetProfile } from './lib/patientAuth';
import LoginScreen from './LoginScreen';
import RegisterScreen from './RegisterScreen';
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
function parseRegisterUrl() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const m = path.match(/^\/patient-register(?:\/([^/]+))?\/?$/);
  if (m) return { view: 'register', practiceRef: m[1] || params.get('practice') || null };
  if (params.get('practice')) return { view: 'register', practiceRef: params.get('practice') };
  return { view: 'login', practiceRef: null };
}

export default function App() {
  const [profile, setProfile] = useState(null);
  const [checking, setChecking] = useState(true);
  const [{ view: initialView, practiceRef }] = useState(parseRegisterUrl);
  const [view, setView] = useState(initialView); // 'login' | 'register'

  // If a session already exists (e.g. this browser just logged in through
  // the real patient-login.html), pick it up instead of asking again --
  // same spirit as patient.html's own session check.
  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      if (data.session) {
        const p = await patientGetProfile();
        if (p) setProfile(p);
      }
      setChecking(false);
    })();
  }, []);

  if (checking) return null;

  async function handleProfileSwitched() {
    const p = await patientGetProfile();
    if (p) setProfile(p);
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

  return view === 'register' ? (
    <RegisterScreen practiceRef={practiceRef} onBackToLogin={() => setView('login')} />
  ) : (
    <LoginScreen onLoggedIn={setProfile} onRegister={() => setView('register')} />
  );
}
