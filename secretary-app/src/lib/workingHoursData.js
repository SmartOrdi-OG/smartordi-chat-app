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

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // matches Date.getDay()
export function workingHoursFor(dateStr, hours) {
  const key = WEEKDAY_KEYS[new Date(dateStr + 'T00:00:00').getDay()];
  return (hours && hours[key]) || { open: false, blocks: [] };
}

// Steps every configured [start,end] block by 15 minutes -- mirrors
// buildTimeSlotsFromBlocks().
export function buildTimeSlotsFromBlocks(blocks) {
  const slots = [];
  (blocks || []).forEach((block) => {
    let [h, m] = block[0].split(':').map(Number);
    const [toH, toM] = block[1].split(':').map(Number);
    while (h < toH || (h === toH && m <= toM)) {
      slots.push(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
      m += 15;
      if (m >= 60) { m = 0; h++; }
    }
  });
  return slots;
}

// "Bis" options need something after the last bookable start of each block
// -- extends every block's own end by 30 minutes. Mirrors
// buildEndSlotsFromBlocks().
export function buildEndSlotsFromBlocks(blocks) {
  const extended = (blocks || []).map((b) => {
    const [h, m] = b[1].split(':').map(Number);
    const total = ((h * 60 + m + 30) % 1440 + 1440) % 1440;
    return [b[0], String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')];
  });
  return buildTimeSlotsFromBlocks(extended);
}

export async function saveWorkingHours(practiceId, workingHours) {
  const { error } = await sb.from('practices').update({ working_hours: workingHours }).eq('id', practiceId);
  if (error) {
    console.error('saveWorkingHours failed', error);
    return false;
  }
  return true;
}
