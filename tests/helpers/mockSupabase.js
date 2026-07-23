// Shared in-memory mock for window.supabase.createClient(), installed via
// page.addInitScript() before any page script runs. This sandbox has no
// live network access to a real Supabase project, so every test in this
// suite drives the actual app code (doctor.html/secretary.html/... and
// vendor/*.js) against this fake backend instead -- the same technique
// used throughout this project's manual verification all along, now
// checked in as real, repeatable CI tests instead of one-off scratchpad
// scripts.
//
// Usage:
//   const {installMockSupabase} = require('./helpers/mockSupabase');
//   await installMockSupabase(page, { patients: [...], termine: [...] });
//
// `seed` is a plain JSON-serializable object merged over an empty store
// covering every table this app currently uses. After the page has
// loaded, tests can still reach into window.__store to assert on what
// got written, or reassign sb.rpc/sb.channel per-test for RPC-specific
// scenarios (see tests/dsgvo-deletion.spec.js for an example).
const EMPTY_STORE = {
  staff_profiles: [], practices: [], practice_settings: [],
  patients: [], termine: [], patient_messages: [], patient_documents: [],
  mkp_untersuchungen: [], patient_impfungen: [], staff_invites: [],
  patient_join_requests: [], patient_sessions: [], audit_log: [],
  practice_vertretung: [], patient_visits: [], patient_guardians: [], guardian_sessions: [],
};

function mockScript(seed) {
  const store = Object.assign({}, EMPTY_STORE, seed);
  return `
    window.__store = ${JSON.stringify(store)};
    function __matches(x, filters) {
      return filters.every(([op, k, v]) => {
        if (op === 'eq') return x[k] === v;
        if (op === 'neq') return x[k] !== v;
        if (op === 'gte') return x[k] >= v;
        if (op === 'lte') return x[k] <= v;
        return true;
      });
    }
    function __builder(table) {
      const rows = window.__store[table] || (window.__store[table] = []);
      const b = {
        _filters: [], _pendingUpdate: null, _insertedRows: null,
        select() { return b; },
        eq(k, v) { b._filters.push(['eq', k, v]); return b; },
        neq(k, v) { b._filters.push(['neq', k, v]); return b; },
        gte(k, v) { b._filters.push(['gte', k, v]); return b; },
        lte(k, v) { b._filters.push(['lte', k, v]); return b; },
        order() { return b; },
        limit() { return b; },
        maybeSingle() {
          // Same window.__forceError escape hatch then() supports (see its
          // own comment below) -- previously missing here, so an
          // insert()/update().select().maybeSingle() chain (a very common
          // Supabase pattern in this codebase) had no way to simulate a
          // real DB error in a test.
          if (window.__forceError && window.__forceError[table]) {
            return Promise.resolve({ data: null, error: { message: window.__forceError[table] } });
          }
          if (b._pendingUpdate) {
            const matched = rows.filter(x => __matches(x, b._filters));
            matched.forEach(x => Object.assign(x, b._pendingUpdate));
            return Promise.resolve({ data: matched[0] || null, error: null });
          }
          if (b._insertedRows) { b._commit(); return Promise.resolve({ data: b._insertedRows[0], error: null }); }
          const r = rows.filter(x => __matches(x, b._filters));
          return Promise.resolve({ data: r[0] || null, error: null });
        },
        single() {
          if (window.__forceError && window.__forceError[table]) {
            return Promise.resolve({ data: null, error: { message: window.__forceError[table] } });
          }
          if (b._pendingUpdate) {
            const matched = rows.filter(x => __matches(x, b._filters));
            matched.forEach(x => Object.assign(x, b._pendingUpdate));
            return Promise.resolve({ data: matched[0] || null, error: null });
          }
          if (b._insertedRows) { b._commit(); return Promise.resolve({ data: b._insertedRows[0], error: null }); }
          const r = rows.filter(x => __matches(x, b._filters));
          return Promise.resolve({ data: r[0] || null, error: null });
        },
        insert(v) {
          // The actual row(s) are only pushed into the table by _commit(),
          // called from whichever resolution method (single/maybeSingle/
          // then) ends up running -- and only once that method has
          // confirmed window.__forceError isn't set for this table. Real
          // Postgres never persists a row whose statement ultimately
          // errors (e.g. a CHECK constraint violation); eagerly pushing it
          // here regardless of the caller's later forced error would make
          // "a rejected insert leaves no row behind" impossible to test.
          b._insertedRows = Array.isArray(v) ? v : [v];
          b._commit = function () {
            b._insertedRows.forEach(x => {
              if (!x.id) x.id = 'gen-' + Math.random().toString(36).slice(2);
              if (!x.created_at) x.created_at = new Date().toISOString();
              rows.push(x);
            });
          };
          return b;
        },
        upsert(v, opts) {
          const arr = Array.isArray(v) ? v : [v];
          // onConflict may name more than one column (e.g. a composite
          // unique constraint like 'patient_id,exam_key') -- comparing the
          // whole comma-joined string as a single, nonexistent property
          // made every row's r[conflictKey] equal undefined, so find()
          // matched the first row in the table regardless of its actual
          // patient_id/exam_key. Split into real column names and require
          // every one to match (and be actually defined) instead.
          const conflictKeys = opts && opts.onConflict ? opts.onConflict.split(',').map(k => k.trim()) : null;
          const matches = (r, x) => conflictKeys.every(k => x[k] !== undefined && r[k] === x[k]);
          // Same deferred-commit reasoning as insert() above.
          b._insertedRows = arr;
          b._commit = function () {
            b._insertedRows = arr.map(x => {
              const existing = conflictKeys ? rows.find(r => matches(r, x)) : null;
              if (existing) { Object.assign(existing, x); return existing; }
              if (!x.id) x.id = 'gen-' + Math.random().toString(36).slice(2);
              rows.push(x);
              return x;
            });
          };
          return b;
        },
        update(v) { b._pendingUpdate = v; return b; },
        delete() {
          const matched = rows.filter(x => __matches(x, b._filters));
          matched.forEach(x => { const i = rows.indexOf(x); if (i >= 0) rows.splice(i, 1); });
          return Promise.resolve({ data: matched, error: null });
        },
        then(res, rej) {
          // Tests can set window.__forceError[table] = 'message' to make
          // the next write against that table resolve as a real Supabase
          // error, e.g. to verify error-handling paths without needing a
          // live (and therefore unreachable, from this sandbox) database.
          if (window.__forceError && window.__forceError[table]) {
            return Promise.resolve({ data: null, error: { message: window.__forceError[table] } }).then(res, rej);
          }
          if (b._insertedRows) { b._commit(); return Promise.resolve({ data: b._insertedRows, error: null }).then(res, rej); }
          if (b._pendingUpdate) {
            const matched = rows.filter(x => __matches(x, b._filters));
            matched.forEach(x => Object.assign(x, b._pendingUpdate));
            return Promise.resolve({ data: matched, error: null }).then(res, rej);
          }
          const r = rows.filter(x => __matches(x, b._filters));
          return Promise.resolve({ data: r, error: null }).then(res, rej);
        },
      };
      return b;
    }
    window.supabase = {
      createClient: () => ({
        from: (t) => __builder(t),
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        rpc: () => Promise.resolve({ data: null, error: null }),
        // Reassignable per-test the same way sb.rpc already is (see
        // dsgvo-deletion.spec.js) -- e.g.
        // sb.functions.invoke = async (name, opts) => ({data:{url:'...'}, error:null});
        // Previously missing entirely, so any code calling
        // sb.functions.invoke(...) (send-report-email, create-checkout-session,
        // create-billing-portal-session) threw "Cannot read properties of
        // undefined" the moment a test reached it.
        functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
        auth: {
          signUp: () => Promise.resolve({ data: { user: { id: 'new-user-uuid' } }, error: null }),
          signInWithPassword: () => Promise.resolve({ data: { user: null }, error: { message: 'not mocked' } }),
          onAuthStateChange() {},
          getSession() { return Promise.resolve({ data: { session: null } }); },
        },
      }),
    };
  `;
}

async function installMockSupabase(page, seed, extraInit) {
  // Every staff/patient-facing page loads the real @supabase/supabase-js
  // library from a CDN via <script src="https://cdn.jsdelivr.net/...">.
  // addInitScript() runs before that tag executes, so on a network that
  // can reach the CDN (unlike this sandbox, but very much like a normal
  // CI runner) the real library loads afterwards and overwrites
  // window.supabase with itself -- silently discarding this mock and
  // sending every subsequent sb.from(...) call to the actual production
  // Supabase project instead. Abort that one request so the mock always
  // wins regardless of what network the test happens to run on.
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route => route.abort());
  await page.addInitScript(mockScript(seed || {}));
  if (extraInit) await page.addInitScript(extraInit);
}

module.exports = { installMockSupabase, mockScript };
