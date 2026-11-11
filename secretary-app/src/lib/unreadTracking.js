// Mirrors secretary.html's CHAT_LAST_VIEWED_KEY/markChatViewed()/
// unreadCountFor() -- a per-device, localStorage-only "last viewed"
// marker (never synced to Supabase, same as the original). A patient
// never seen on this device before counts everything from this page
// load onward as unread, not their whole pre-existing history.
const KEY = 'smartordi_sec_chat_last_viewed';
const SESSION_START = new Date().toISOString();

function loadMap() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function saveMap(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

export function markChatViewed(patientId) {
  const map = loadMap();
  map[patientId] = new Date().toISOString();
  saveMap(map);
}

// Returns the "last viewed" timestamp for this patient, seeding it to this
// session's start the first time it's ever asked about (same anchoring as
// the original -- see its own comment on the real bug this fixes).
export function lastViewedFor(patientId) {
  const map = loadMap();
  if (!map[patientId]) {
    map[patientId] = SESSION_START;
    saveMap(map);
    return SESSION_START;
  }
  return map[patientId];
}
