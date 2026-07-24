# Repo instructions

- After pushing a branch with completed work, automatically open a pull request (no need to ask first). Only skip this if the user explicitly says not to.
- After opening a pull request, automatically merge it too (no need to ask first), so changes reach `main`/Vercel production without an extra round trip. Only skip this if the user explicitly says not to, or the PR has unresolved review comments/failing checks.
- Whenever you hand the user a new/updated `supabase/phaseNN_*.sql` (or any other SQL) file to run themselves, end that message with a reminder to also run `supabase/schema_health_check.sql` afterward to confirm it actually applied cleanly. This exists because of a real incident (2026-07-24, see `TODO.md`): a migration silently never fully applied, and a later unrelated change assumed it had, causing the entire patient list to vanish with no visible error.
