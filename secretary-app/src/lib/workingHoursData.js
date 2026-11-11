import { sb } from './supabase';

// Mirrors vendor/staff-accounts.js's DEFAULT_WORKING_HOURS/getWorkingHours()
// and secretary.html's Öffnungszeiten modal (supabase/phase29_practice_
// working_hours.sql) -- configurable per-weekday open/closed + up to two
// time blocks, stored on practices.working_hours (falls back to this same
// fixed Mon-Fri schedule when a practice hasn't configured it yet).
export const WH_DAYS = [
  ['mon', 'Montag'], ['tue', 'Dienstag'], ['wed', 'Mittwoch'], ['thu', 'Donnerstag'],
  ['fri', 'Freitag'], ['sat', 'Samstag'], ['sun', 'Sonntag'],
];

export const DEFAULT_WORKING_HOURS = {
  mon: { open: true, blocks: [['08:00', '11:30'], ['14:00', '16:00']] },
  tue: { open: true, blocks: [['08:00', '11:30'], ['14:00', '16:00']] },
  wed: { open: true, blocks: [['08:00', '11:30'], ['14:00', '16:00']] },
  thu: { open: true, blocks: [['08:00', '11:30'], ['14:00', '16:00']] },
  fri: { open: true, blocks: [['08:00', '11:30'], ['14:00', '16:00']] },
  sat: { open: false, blocks: [] },
  sun: { open: false, blocks: [] },
};

export function getWorkingHours(practiceSettings) {
  return (practiceSettings && practiceSettings.working_hours) || DEFAULT_WORKING_HOURS;
}

export async function saveWorkingHours(practiceId, workingHours) {
  const { error } = await sb.from('practices').update({ working_hours: workingHours }).eq('id', practiceId);
  if (error) {
    console.error('saveWorkingHours failed', error);
    return false;
  }
  return true;
}
