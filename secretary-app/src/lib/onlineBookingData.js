import { sb } from './supabase';

// Mirrors vendor/staff-accounts.js's isOnlineBookingEnabled()/
// toggleOnlineBooking() (supabase/phase44_online_booking_toggle.sql) --
// practice-wide switch for whether a patient can self-book a Termin
// (enforced server-side in patient_book_termin() itself; this is only the
// visible half, same as the original). Fail-open default, same reasoning
// as the original: a practice row predating this column has
// online_booking_enabled null, which must keep booking working exactly as
// before rather than silently blocking every patient.
export function isOnlineBookingEnabled(practice) {
  return practice?.online_booking_enabled !== false;
}

export async function setOnlineBookingEnabled(practiceId, enabled) {
  const { error } = await sb.from('practices').update({ online_booking_enabled: enabled }).eq('id', practiceId);
  if (error) {
    console.error('setOnlineBookingEnabled failed', error);
    return false;
  }
  return true;
}
