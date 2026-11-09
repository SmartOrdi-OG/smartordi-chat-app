import { useEffect, useState } from 'react';
import { sb } from './lib/supabase';
import { patientGetProfile } from './lib/patientAuth';
import LoginScreen from './LoginScreen';
import PatientPortal from './PatientPortal';

export default function App() {
  const [profile, setProfile] = useState(null);
  const [checking, setChecking] = useState(true);

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

  return profile ? (
    <PatientPortal profile={profile} onLoggedOut={() => setProfile(null)} />
  ) : (
    <LoginScreen onLoggedIn={setProfile} />
  );
}
