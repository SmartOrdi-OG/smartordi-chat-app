# SmartOrdi

SmartOrdi is a web app for Austrian medical practices (Ordinationen): a
doctor/secretary staff console plus a patient portal, covering appointments,
patient records (Kartei), chat/messaging, document uploads, prescriptions,
and billing — built as a static multi-page app backed by Supabase.

## Tech stack

- **Frontend**: plain HTML/CSS/JS, no build step, no framework. Each role has
  its own top-level page:
  - `login.html` — staff login
  - `register.html` — practice sign-up
  - `doctor.html` / `secretary.html` — staff consoles (Kalender, Kartei,
    Patienten, chat, Einstellungen, billing, ...)
  - `patient.html` / `patient-login.html` — patient/guardian portal
  - `agb.html`, `datenschutz.html`, `impressum.html` — legal pages
  - Shared client-side logic that's grown large enough to extract lives in
    `vendor/` (e.g. `patient-data.js`, `staff-accounts.js`, the `kartei-*.js`
    modules, `i18n-patient.js` for patient-facing translations).
- **Backend**: [Supabase](https://supabase.com) (Postgres + Auth + Realtime +
  Storage + Edge Functions). There is no separate app server — pages talk to
  Supabase directly from the browser, with access controlled by Row Level
  Security policies.
  - SQL migrations live in `supabase/phaseNN_*.sql`, applied in order.
  - Edge Functions live in `supabase/functions/*` (e.g.
    `create-patient-auth-user`, Stripe checkout/billing endpoints, lab-result
    email intake, error notifications).
- **Email intake**: `cloudflare/email-worker` — a Cloudflare Email Worker
  that forwards incoming lab-result emails into Supabase.
- **Hosting**: deployed as a static site on Vercel (see `vercel.json` for
  routing/CSP headers).
- **Tests**: [Playwright](https://playwright.dev), run against the HTML
  files directly (`file://`) with Supabase mocked out — see
  `tests/helpers/mockSupabase.js`. No live Supabase project or network access
  is needed to run the suite.

## Getting started

```bash
npm install
npx playwright install   # first time only, downloads browser binaries
npm test                 # runs the full Playwright suite
```

To try the app itself locally, just open the HTML files directly in a
browser (e.g. `login.html`), or serve the directory with any static file
server. A real Supabase project (URL + anon key, wired up in the pages) is
needed for the app to actually persist data — the test suite instead runs
entirely against a mocked Supabase client.

## Database migrations

Each `supabase/phaseNN_*.sql` file is a one-time migration, meant to be run
in order against the project's Supabase SQL editor. **After running any
migration file, also run `supabase/schema_health_check.sql`** to confirm it
actually applied cleanly — this exists because of a real incident
(2026-07-24, see `TODO.md`) where a migration silently failed to fully
apply, and a later unrelated change assumed it had, causing the entire
patient list to vanish with no visible error.

## Project history / decision log

`TODO.md` is a running, detailed log (mostly in Arabic) of everything built,
every bug found and fixed, and the reasoning behind larger architectural
decisions (multi-tenancy, patient auth, DSGVO/GDPR compliance, pricing
tiers, etc.). It's the best place to look for *why* something is built the
way it is.
