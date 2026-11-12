import { patientLogin } from './patientAuth';
import { checkJoinRequestStatus } from './patientRegister';
import { tr } from './i18n';

// Mirrors patient-login.html's doLogin() branching -- centralized here so
// both a manually-typed login (LoginScreen) and a QR-provisioned
// auto-login (App.jsx's tryQrLogin()-equivalent) resolve the exact same
// way. The legacy local/demo-account and guardian-table fallbacks from the
// original are deliberately not ported (guardian accounts were already
// soft-migrated into the unified patient_account_profiles system this
// portal's own "Meine Profile" already uses -- see phase66's own header).
//
// Mirrors doLogin()'s "has this patient already filled in their Anamnese"
// check (supabase/phase8_anamnese.sql): mandatory on a first login
// (firstLogin flag), and for a self-registered account's first login after
// approval (joinStatus === 'approved' && no anamnese yet) even once
// password/consent are already out of the way -- but never re-prompted
// once answered, and never for a staff-created (non-self-registered)
// account past its own first login.
function needsAnamnese(profile) {
  return !profile.anamnese && (!!profile.firstLogin || profile.joinStatus === 'approved');
}

// Returns one of:
//   { kind: 'portal', profile }
//   { kind: 'firstlogin', profile, needsUsername, needsPassword, needsConsent, needsAnamnese }
//   { kind: 'anamnese', profile }
//   { kind: 'pending' | 'rejected', note }
//   { kind: 'invalid' }
//   { kind: 'error', message }
export async function resolveLogin(username, password, { qrNeedsNewUsername = false } = {}) {
  let profile;
  try {
    profile = await patientLogin(username, password);
  } catch (err) {
    const msg = (err && err.message) || '';
    if (msg.indexOf('account_locked') !== -1) {
      return { kind: 'error', message: tr('login.error.accountLocked') };
    }
    if (msg.indexOf('temp_password_expired') !== -1) {
      return { kind: 'error', message: tr('login.error.tempPasswordExpired') };
    }
    throw err;
  }

  if (profile) {
    if (profile.joinStatus === 'pending' || profile.joinStatus === 'rejected') {
      return { kind: profile.joinStatus, note: profile.joinNote || '' };
    }
    const needsConsent = !profile.consentGiven;
    const anamneseDue = needsAnamnese(profile);
    if (profile.firstLogin) {
      return {
        kind: 'firstlogin', profile, needsPassword: true, needsConsent,
        needsUsername: !!profile.isChild || !!qrNeedsNewUsername,
        needsAnamnese: anamneseDue,
      };
    }
    if (needsConsent) {
      return {
        kind: 'firstlogin', profile, needsPassword: false, needsUsername: false, needsConsent: true,
        needsAnamnese: anamneseDue,
      };
    }
    if (anamneseDue) {
      return { kind: 'anamnese', profile };
    }
    return { kind: 'portal', profile };
  }

  // No real account to sign in to yet -- could still be a self-registered
  // patient whose join request hasn't been approved (or was turned down).
  const status = await checkJoinRequestStatus(username);
  if (status && (status.status === 'pending' || status.status === 'rejected')) {
    return { kind: status.status, note: status.note || '' };
  }
  return { kind: 'invalid' };
}
