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
  client_error_log: [], patient_pflegefreistellung: [], patient_arbeitsunfaehigkeit: [],
  patient_vaccine_dismissals: [], patient_lab_results: [],
};

function mockScript(seed) {
  const store = Object.assign({}, EMPTY_STORE, seed);
  return `
    window.__store = ${JSON.stringify(store)};
    // Columns with NOT NULL and no default, per table (patients.name/
    // full_name, patient_guardians.name/full_name -- see phase1_patients_
    // termine_messages.sql/phase28_guardian_child_accounts.sql). Used only
    // by upsert() below: a real INSERT ... ON CONFLICT DO UPDATE validates
    // NOT NULL constraints against the attempted INSERT tuple BEFORE
    // Postgres even checks for a conflict -- so a partial-field upsert on
    // an ALREADY-EXISTING row still fails if the payload alone is missing
    // one of these, even though the row was never actually going to be
    // inserted. Real incident this simulates: vendor/patient-data.js's
    // upsertPatientIdentity()/upsertGuardianIdentity() (see their own
    // comments) -- found live in production (2026-08-03) via a genuine
    // Anamnese-save failure, invisible here until this mock modeled the
    // same gotcha real Postgres has.
    const __UPSERT_REQUIRED_COLUMNS = {
      patients: ['username', 'name', 'full_name'],
      patient_guardians: ['username', 'name', 'full_name'],
    };
    // window.__forceError[table] can be a plain string (the common case --
    // wrapped into {message} as before) or a full error-shaped object, so a
    // test can simulate a specific real Postgres error code (e.g. '23505'
    // unique_violation) instead of just a generic message. Used by
    // insertNewPatientIdentity()'s username-collision handling
    // (vendor/patient-data.js), which specifically branches on error.code.
    function __forceErrorObj(table) {
      const v = window.__forceError[table];
      return typeof v === 'string' ? { message: v } : v;
    }
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
      if (op === 'gt') return x[k] > v;
      if (op === 'lt') return x[k] < v;
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
    // _orders is a list (one entry per chained .order() call, in call
    // order) so a composite ORDER BY (e.g. updated_at DESC, id DESC --
    // real cursor pagination's tie-break, see loadPatientListPage() in
    // vendor/patient-data.js) sorts the same way real Postgres does:
    // ties on the first key are broken by the second, not left in
    // whatever order the array happened to already be in.
    function __applyOrderLimit(rows, b) {
      let out = rows;
      if (b._orders && b._orders.length) {
        out = out.slice().sort((a, c) => {
          for (const { col, asc } of b._orders) {
            const av = a[col], cv = c[col];
            if (av === cv) continue;
            const cmp = av < cv ? -1 : 1;
            return asc ? cmp : -cmp;
          }
          return 0;
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
        gt(k, v) { b._filters.push(['gt', k, v]); return b; },
        lt(k, v) { b._filters.push(['lt', k, v]); return b; },
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
        // Each chained .order() call appends (real supabase-js composes a
        // multi-column ORDER BY this way -- .order('a').order('b') means
        // ORDER BY a, b, not "b wins").
        order(col, opts) { (b._orders || (b._orders = [])).push({ col, asc: !(opts && opts.ascending === false) }); return b; },
        limit(n) { b._limit = n; return b; },
        maybeSingle() {
          // Same window.__forceError escape hatch then() supports (see its
          // own comment below) -- previously missing here, so an
          // insert()/update().select().maybeSingle() chain (a very common
          // Supabase pattern in this codebase) had no way to simulate a
          // real DB error in a test.
          if (window.__forceError && window.__forceError[table]) {
            return Promise.resolve({ data: null, error: __forceErrorObj(table) });
          }
          if (b._pendingUpdate) {
            const matched = rows.filter(x => __matches(x, b._filters, b._orGroup));
            matched.forEach(x => Object.assign(x, b._pendingUpdate));
            return Promise.resolve({ data: matched[0] || null, error: null });
          }
          if (b._insertedRows) {
            if (b._upsertRequiredCheck) {
              const upsertErr = b._upsertRequiredCheck();
              if (upsertErr) return Promise.resolve({ data: null, error: upsertErr });
            }
            b._commit();
            return Promise.resolve({ data: b._insertedRows[0], error: null });
          }
          const r = __applyOrderLimit(rows.filter(x => __matches(x, b._filters, b._orGroup)), b);
          return Promise.resolve({ data: r[0] || null, error: null });
        },
        single() {
          if (window.__forceError && window.__forceError[table]) {
            return Promise.resolve({ data: null, error: __forceErrorObj(table) });
          }
          if (b._pendingUpdate) {
            const matched = rows.filter(x => __matches(x, b._filters, b._orGroup));
            matched.forEach(x => Object.assign(x, b._pendingUpdate));
            return Promise.resolve({ data: matched[0] || null, error: null });
          }
          if (b._insertedRows) {
            if (b._upsertRequiredCheck) {
              const upsertErr = b._upsertRequiredCheck();
              if (upsertErr) return Promise.resolve({ data: null, error: upsertErr });
            }
            b._commit();
            return Promise.resolve({ data: b._insertedRows[0], error: null });
          }
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
          // See __UPSERT_REQUIRED_COLUMNS's own comment above -- checked
          // against the raw payload alone, regardless of whether a
          // matching existing row will be found, same as real Postgres.
          const required = __UPSERT_REQUIRED_COLUMNS[table];
          b._upsertRequiredCheck = () => {
            if (!required) return null;
            for (const x of arr) {
              for (const col of required) {
                if (x[col] === undefined || x[col] === null) {
                  return { code: '23502', details: null, hint: null, message: 'null value in column "' + col + '" of relation "' + table + '" violates not-null constraint' };
                }
              }
            }
            return null;
          };
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
            return Promise.resolve({ data: null, error: __forceErrorObj(table) }).then(res, rej);
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
          if (b._insertedRows) {
            if (b._upsertRequiredCheck) {
              const upsertErr = b._upsertRequiredCheck();
              if (upsertErr) return Promise.resolve({ data: null, error: upsertErr }).then(res, rej);
            }
            b._commit();
            return Promise.resolve({ data: b._insertedRows, error: null }).then(res, rej);
          }
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
          // Real Supabase (autoconfirm on, as this project's project is
          // configured) returns a real session alongside the new user, not
          // just the user alone -- register.html's own signup flow now
          // depends on that session.access_token being present (see its
          // "Real bug found 2026-08-16" comment) to build a one-off client
          // that can't race the shared client's own session-sync timing.
          // Missing this field here would let that whole code path go
          // permanently untested (always silently falling back to the
          // shared sb client), exactly how the real bug went uncaught
          // until a live walkthrough test found it.
          signUp: () => Promise.resolve({ data: { user: { id: 'new-user-uuid' }, session: { access_token: 'mock-access-token', refresh_token: 'mock-refresh-token' } }, error: null }),
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
          // Captures the callback instead of a true no-op so a test can
          // simulate a real Supabase auth event (e.g. the pilot-login
          // magic-link SIGNED_IN callback in login.html) via
          // window.__authStateChangeCallback('SIGNED_IN', {user:{id:...}}).
          // Never auto-invoked by this mock itself -- no existing test
          // relied on this firing, so this stays a no-op unless a test
          // opts in explicitly.
          onAuthStateChange(cb) {
            window.__authStateChangeCallback = cb;
            return { data: { subscription: { unsubscribe() {} } } };
          },
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
            // An explicit override lets a test simulate a real Supabase Auth
            // session that exists INDEPENDENTLY of this app's own
            // sessionStorage.smartordi_user -- e.g. patient.html's
            // rehydrateSessionFromRealAuth() (sessionStorage empty/cleared,
            // but the real Auth session in localStorage is still valid).
            // The sessionStorage-mirroring fallback below can never express
            // that case, since it goes null the instant sessionStorage does
            // too. Set via window.__mockAuthSession = {...} / null.
            if ('__mockAuthSession' in window) return Promise.resolve({ data: { session: window.__mockAuthSession } });
            let cached = null;
            try { cached = JSON.parse(sessionStorage.getItem('smartordi_user')); } catch (e) {}
            if (!cached || !cached.username) return Promise.resolve({ data: { session: null } });
            return Promise.resolve({ data: { session: { user: { id: cached.username } } } });
          },
          // Reassignable per-test (see sb.rpc/sb.functions.invoke above) --
          // no test needed this before rehydrateSessionFromRealAuth()'s
          // refresh-and-retry-once fallback.
          refreshSession: () => Promise.resolve({ data: { session: null }, error: { message: 'not mocked' } }),
        },
      }),
    };

    // register.html's registration-RLS-race fix (2026-08-16) calls the
    // REST API directly via fetch() for the practices/staff_profiles writes
    // that immediately follow signUp() -- see that file's own comment for
    // why (two earlier fix attempts through window.supabase.createClient()
    // both looked right in code review but were STILL failing live, so this
    // one deliberately bypasses the supabase-js client entirely instead of
    // trusting its internal session/header logic again). Mocked here by
    // routing any POST .../rest/v1/<table> request through the exact same
    // __builder(table).insert(...).select().single() path sb.from() already
    // uses, so it shares the same window.__store/__forceError semantics as
    // every other insert in this mock. Every call (including its headers,
    // so a test can assert on the exact Authorization actually sent) is
    // recorded in window.__fetchCalls.
    const __realFetch = window.fetch ? window.fetch.bind(window) : null;
    window.__fetchCalls = [];
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = (init && init.method) || 'GET';
      const headersObj = {};
      if (init && init.headers) {
        Object.keys(init.headers).forEach(function (k) { headersObj[k] = init.headers[k]; });
      }
      window.__fetchCalls.push({ url: url, method: method, headers: headersObj, body: init && init.body });
      const m = url.match(/\\/rest\\/v1\\/([a-zA-Z0-9_]+)/);
      if (m && method === 'POST') {
        const table = m[1];
        let payload;
        try { payload = JSON.parse(init.body); } catch (e) { payload = init.body; }
        const result = await __builder(table).insert(payload).select().single();
        if (result.error) {
          return new Response(JSON.stringify(result.error), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify([result.data]), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (__realFetch) return __realFetch(input, init);
      throw new Error('fetch() called for an unmocked URL by this test: ' + url);
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
