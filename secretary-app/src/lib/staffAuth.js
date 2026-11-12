import { sb } from './supabase';

// Mirrors login.html's doLogin() -- real Supabase Auth, same staff_profiles
// lookup. Unlike login.html this never redirects to a separate page: both
// arzt and sekretaer accounts can sign in here (secretary-app has no
// server-side route split yet), the shell just shows whatever role/name the
// profile carries.
export async function staffSignIn(email, password) {
  const { data: signInData, error: signInError } = await sb.auth.signInWithPassword({ email, password });
  if (signInError || !signInData.user) {
    const notConfirmed = signInError && (signInError.code === 'email_not_confirmed' || /email not confirmed/i.test(signInError.message || ''));
    return {
      ok: false,
      error: notConfirmed
        ? 'Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse über den Link, den wir Ihnen gesendet haben.'
        : 'Falsche E-Mail oder Passwort.',
    };
  }
  const profile = await fetchStaffProfile(signInData.user.id);
  if (!profile) {
    await sb.auth.signOut();
    return { ok: false, error: 'Kein Praxisprofil für dieses Konto gefunden.' };
  }
  return { ok: true, profile };
}

export async function staffSignOut() {
  await sb.auth.signOut();
}

export async function fetchStaffProfile(userId) {
  const { data, error } = await sb.from('staff_profiles').select('*').eq('id', userId).single();
  if (error || !data) return null;
  return {
    id: data.id,
    role: data.role,
    fullName: data.full_name,
    isAdmin: !!data.is_admin,
    fach: data.fach || null,
  };
}

// RLS already scopes `staff_profiles`/`practices` to the caller's own
// practice (current_practice_id()), same transparent-filtering pattern the
// rest of the app relies on -- no practice_id needs to be known up front.
export async function fetchPracticeSettings() {
  const { data, error } = await sb.from('practices').select('*').limit(1).maybeSingle();
  if (error) {
    console.error('fetchPracticeSettings failed', error);
    return null;
  }
  return data || null;
}

// Mirrors vendor/patient-account-creation.js's practiceAdminFach() -- the
// admin arzt's real fach, used for a new patient's QR/Anamnese specialty
// instead of any per-device setting.
export async function fetchPracticeAdminFach() {
  const { data, error } = await sb.from('staff_profiles').select('fach').eq('role', 'arzt').eq('is_admin', true).limit(1).maybeSingle();
  if (error) {
    console.error('fetchPracticeAdminFach failed', error);
    return 'Allgemeinmedizin';
  }
  return (data && data.fach) || 'Allgemeinmedizin';
}

// Mirrors secretary.html's practiceAdminName() -- used on the
// Termininformationen print slip's "Ordination ..." footer line, same as
// the original (the practice's own `name` field isn't used there).
export async function fetchPracticeAdminName() {
  const { data, error } = await sb.from('staff_profiles').select('full_name').eq('role', 'arzt').eq('is_admin', true).limit(1).maybeSingle();
  if (error) {
    console.error('fetchPracticeAdminName failed', error);
    return '—';
  }
  return (data && data.full_name) || '—';
}

// On load, Supabase Auth itself persists the session (localStorage) --
// this just re-resolves the real staff_profiles row for whatever session
// comes back, mirroring login.html's own post-sign-in lookup.
export async function restoreStaffSession() {
  const { data } = await sb.auth.getSession();
  const user = data && data.session && data.session.user;
  if (!user) return null;
  const profile = await fetchStaffProfile(user.id);
  if (!profile) return null;
  return profile;
}
