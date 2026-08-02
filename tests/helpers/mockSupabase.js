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
  doctor_hidden_chats: [], patient_rezepte: [], patient_ueberweisungen: [],
  client_error_log: [],
};

function mockScript(seed) {
  const store = Object.assign({}, EMPTY_STORE, seed);
  return `
    window.__store = ${JSON.stringify(store)};
    // Turns a Postgres ILIKE pattern into a match against one value. Only
    // handles the % wildcard the way this app actually uses it (always a
    // simple '%term%'/'term%'/'%term' contains/starts/ends search, never a
    // general ILIKE pattern language) and unescapes the \\% / \\_ this app's
    // own searchPatientsServer() (vendor/patient-data.js) applies to user
    // input before building the pattern.
    function __ilikeMatch(val, pattern) {
      if (val === null || val === undefined) return false;
      let p = String(pattern);
      const lead = p.startsWith('%'); if (lead) p = p.slice(1);
      const trail = p.endsWith('%'); if (trail) p = p.slice(0, -1);
      p = p.replace(/\\\\%/g, '%').replace(/\\\\_/g, '_');
      const hay = String(val).toLowerCase(), needle = p.toLowerCase();
      if (lead && trail) return hay.includes(needle);
      if (trail) return hay.startsWith(needle);
      if (lead) return hay.endsWith(needle);
      return hay === needle;
    }
    function __matchesOne(x, [op, k, v]) {
      if (op === 'eq') return x[k] === v;
      if (op === 'neq') return x[k] !== v;
      if (op === 'gte') return x[k] >= v;
      if (op === 'lte') return x[k] <= v;
      if (op === 'ilike') return __ilikeMatch(x[k], v);
      return true;
    }
    // filters (from .eq()/.neq()/.../.ilike()) are ANDed together, same as
    // real Supabase chaining. orGroup (from a single .or('a.op.b,c.op.d')
    // call) is a separate OR-group checked on top -- a row must satisfy
    // every AND filter AND at least one OR clause, matching how
    // searchPatientsServer() combines a base filter set with a name-or-svnr
    // search.
    function __matches(x, filters, orGroup) {
      if (!filters.every(f => __matchesOne(x, f))) return false;
      if (orGroup && orGroup.length) return orGroup.some(f => __matchesOne(x, f));
      return true;
    }
    // Applies real ordering/limiting to a result set -- previously both
    // were silent no-ops, which was fine while nothing depended on actual
    // row order/truncation, but a live search needs both to behave for
    // real (limit() genuinely bounding a large table, order() genuinely
    // surfacing the most relevant/recent matches first).
    function __applyOrderLimit(rows, b) {
      let out = rows;
      if (b._orderCol) {
        out = out.slice().sort((a, c) => {
          const av = a[b._orderCol], cv = c[b._orderCol];
          if (av === cv) return 0;
          const cmp = av < cv ? -1 : 1;
          return b._orderAsc ? cmp : -cmp;
        });
      }
      if (b._limit != null) out = out.slice(0, b._limit);
      return out;
    }
    function __builder(table) {
      const rows = window.__store[table] || (window.__store[table] = []);
      const b = {
        _filters: [], _pendingUpdate: null, _insertedRows: null, _selectCols: null,
        // opts is Supabase's second select() argument, {count:'exact',head:true}
        // -- used by isPatientLimitReached() (vendor/staff-accounts.js) and
        // doctor.html's patient_messages count query. head:true means the
        // caller only wants the count, not the actual rows.
        select(cols, opts) { b._selectCols = cols; if (opts && opts.count) { b._countMode = opts.count; b._head = !!opts.head; } return b; },
        eq(k, v) { b._filters.push(['eq', k, v]); return b; },
        neq(k, v) { b._filters.push(['neq', k, v]); return b; },
        gte(k, v) { b._filters.push(['gte', k, v]); return b; },
        lte(k, v) { b._filters.push(['lte', k, v]); return b; },
        ilike(k, v) { b._filters.push(['ilike', k, v]); return b; },
        // Parses Supabase's "col.op.val,col2.op.val2" string format into an
        // OR-group of [op,col,val] triples (searchPatientsServer()'s
        // 'full_name.ilike.%x%,svnr.ilike.%x%' being the one real caller in
        // this codebase). A row matches if it satisfies every AND filter
        // above AND at least one clause here -- see __matches()'s own comment.
        or(exprString) {
          b._orGroup = String(exprString).split(',').map(part => {
            const m = part.match(/^([^.]+)\.([^.]+)\.(.*)$/);
            return m ? [m[2], m[1], m[3]] : null;
          }).filter(Boolean);
          return b;
        },
        order(col, opts) { b._orderCol = col; b._orderAsc = !(opts && opts.ascending === false); return b; },
        limit(n) { b._limit = n; return b; },
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
            const matched = rows.filter(x => __matches(x, b._filters, b._orGroup));
            matched.forEach(x => Object.assign(x, b._pendingUpdate));
            return Promise.resolve({ data: matched[0] || null, error: null });
          }
          if (b._insertedRows) { b._commit(); return Promise.resolve({ data: b._insertedRows[0], error: null }); }
          const r = __applyOrderLimit(rows.filter(x => __matches(x, b._filters, b._orGroup)), b);
          return Promise.resolve({ data: r[0] || null, error: null });
        },
        single() {
          if (window.__forceError && window.__forceError[table]) {
            return Promise.resolve({ data: null, error: { message: window.__forceError[table] } });
          }
          if (b._pendingUpdate) {
            const matched = rows.filter(x => __matches(x, b._filters, b._orGroup));
            matched.forEach(x => Object.assign(x, b._pendingUpdate));
            return Promise.resolve({ data: matched[0] || null, error: null });
          }
          if (b._insertedRows) { b._commit(); return Promise.resolve({ data: b._insertedRows[0], error: null }); }
          const r = __applyOrderLimit(rows.filter(x => __matches(x, b._filters, b._orGroup)), b);
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
        // Deferred to then(), same as insert()/upsert()/update() above --
        // real supabase-js's delete() returns a further-chainable query
        // builder (.delete().eq(...), used e.g. by vendor/patient-data.js's
        // deletePatientDocument()), not a resolved promise. Executing
        // eagerly here would run before any .eq() filters chained AFTER
        // .delete() had a chance to be applied to b._filters, silently
        // matching (and deleting) every row in the table instead of just
        // the intended one.
        delete() { b._pendingDelete = true; return b; },
        then(res, rej) {
          // Tests can set window.__forceError[table] = 'message' to make
          // the next write against that table resolve as a real Supabase
          // error, e.g. to verify error-handling paths without needing a
          // live (and therefore unreachable, from this sandbox) database.
          if (window.__forceError && window.__forceError[table]) {
            return Promise.resolve({ data: null, error: { message: window.__forceError[table] } }).then(res, rej);
          }
          // Simulates a migration that added a column but was never fully
          // applied on this project (the 2026-07-24 incident this whole
          // fallback mechanism exists for): only the explicit-column select
          // fails, a plain select('*') still succeeds -- lets tests verify
          // selectWithColumnFallback() (vendor/patient-data.js) actually
          // recovers instead of leaving the cache empty.
          if (window.__forceErrorOnColumns && window.__forceErrorOnColumns[table] && b._selectCols !== '*') {
            return Promise.resolve({ data: null, error: { message: window.__forceErrorOnColumns[table] } }).then(res, rej);
          }
          if (b._insertedRows) { b._commit(); return Promise.resolve({ data: b._insertedRows, error: null }).then(res, rej); }
          if (b._pendingUpdate) {
            const matched = rows.filter(x => __matches(x, b._filters, b._orGroup));
            matched.forEach(x => Object.assign(x, b._pendingUpdate));
            return Promise.resolve({ data: matched, error: null }).then(res, rej);
          }
          if (b._pendingDelete) {
            const matched = rows.filter(x => __matches(x, b._filters, b._orGroup));
            matched.forEach(x => { const i = rows.indexOf(x); if (i >= 0) rows.splice(i, 1); });
            return Promise.resolve({ data: matched, error: null }).then(res, rej);
          }
          const matched = rows.filter(x => __matches(x, b._filters, b._orGroup));
          const r = __applyOrderLimit(matched, b);
          // Real Postgrest's exact count reflects every matching row
          // regardless of limit/range, so it's taken from the pre-limit
          // matched set, not the (possibly limit()-truncated) r.
          if (b._countMode) {
            return Promise.resolve({ data: b._head ? null : r, error: null, count: matched.length }).then(res, rej);
          }
          return Promise.resolve({ data: r, error: null }).then(res, rej);
        },
      };
      return b;
    }
    window.supabase = {
      createClient: () => ({
        from: (t) => __builder(t),
        // Records each channel's registered postgres_changes handler (keyed
        // by channel name) instead of just no-op'ing it, so a test can
        // simulate a realtime event firing -- e.g.
        // await window.__realtimeHandlers['practice-settings-changes']()
        // -- without needing a real Postgres replication stream this
        // sandbox has no network path to anyway. Chaining behavior (on()/
        // subscribe() returning the same object) is unchanged for every
        // existing caller that never looks at __realtimeHandlers.
        channel: (name) => {
          const ch = {
            on(event, filter, handler) {
              window.__realtimeHandlers = window.__realtimeHandlers || {};
              window.__realtimeHandlers[name] = handler;
              // Also records the postgres_changes options object (table/
              // event/filter) a test can inspect -- e.g. to assert a
              // channel was scoped with a practice_id filter.
              window.__realtimeFilters = window.__realtimeFilters || {};
              window.__realtimeFilters[name] = filter;
              return ch;
            },
            subscribe() { return ch; },
          };
          return ch;
        },
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
          // Added for supabase/phase33_patient_login_cutover.sql -- real
          // patient/guardian login now drives sb.auth directly
          // (patientLogout()/guardianChangePassword()/etc., see
          // vendor/patient-portal-data.js), same reason functions.invoke
          // had to be added above once staff-side Stripe code started
          // calling it.
          signOut: () => Promise.resolve({ error: null }),
          updateUser: () => Promise.resolve({ data: {}, error: null }),
          getUser: () => Promise.resolve({ data: { user: null }, error: null }),
          onAuthStateChange() {},
          // Mirrors whatever sessionStorage.smartordi_user the test itself
          // set up (read lazily, at call time, since installMockSupabase's
          // extraInit callback -- which is what actually sets that key --
          // runs as a separate addInitScript AFTER this factory function is
          // defined but BEFORE the real page code that calls getSession()
          // ever runs). This is what lets every existing test's "already
          // logged in" setup keep looking like a genuinely valid session to
          // guardAgainstStaleLoginSession() (vendor/staff-accounts.js)
          // without each test having to fake one explicitly. A test can
          // still simulate the real stale-session bug this guards against
          // by setting window.__forceNoSession = true.
          getSession() {
            if (window.__forceNoSession) return Promise.resolve({ data: { session: null } });
            let cached = null;
            try { cached = JSON.parse(sessionStorage.getItem('smartordi_user')); } catch (e) {}
            if (!cached || !cached.username) return Promise.resolve({ data: { session: null } });
            return Promise.resolve({ data: { session: { user: { id: cached.username } } } });
          },
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
