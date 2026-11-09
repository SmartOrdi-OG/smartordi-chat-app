// Mirrors vendor/staff-accounts.js's DEFAULT_WORKING_HOURS / workingHoursFor /
// isWorkDay / buildTimeSlotsFromBlocks, so slot generation matches the rest
// of the app exactly.
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const DEFAULT_WORKING_HOURS = {
  mon: { open: true, blocks: [['08:00', '11:30'], ['14:00', '16:00']] },
  tue: { open: true, blocks: [['08:00', '11:30'], ['14:00', '16:00']] },
  wed: { open: true, blocks: [['08:00', '11:30'], ['14:00', '16:00']] },
  thu: { open: true, blocks: [['08:00', '11:30'], ['14:00', '16:00']] },
  fri: { open: true, blocks: [['08:00', '11:30'], ['14:00', '16:00']] },
  sat: { open: false, blocks: [] },
  sun: { open: false, blocks: [] },
};

export function workingHoursFor(dateStr, hours) {
  const key = WEEKDAY_KEYS[new Date(dateStr + 'T00:00:00').getDay()];
  return (hours && hours[key]) || { open: false, blocks: [] };
}

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

export function addMinutesToTime(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  let total = ((h * 60 + m + mins) % 1440 + 1440) % 1440;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

export function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
