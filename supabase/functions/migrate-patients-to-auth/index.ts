// ══ One-time bulk migration: give every EXISTING patient/guardian a real
// Supabase Auth user, preserving their current password ══
//
// create-patient-auth-user (the sibling function) only provisions a real
// Auth user going forward, at the moment a patient/guardian account is
// created or reset from secretary.html. This function is the other half:
// it sweeps every patient/guardian row that predates that change (has a
// pw_hash but no auth_user_id yet) and provisions them too, copying their
// EXISTING password hash across (via the same _set_auth_password_hash SQL
// helper, phase32_auth_password_hash_helper.sql) so nobody has to reset
// anything -- see supabase/phase31_patient_auth.sql's header comment for
// the full reasoning behind this migration.
//
// Not called from the app at all -- this is a manual, one-time operation
// the practice owner triggers themselves (Supabase Dashboard's "Invoke"
// test button, or curl), same handoff spirit as running a phaseNN_*.sql
// file. Deliberately gated by a shared secret (never --no-verify-jwt --
// this still requires a valid Supabase JWT in Authorization, PLUS this
// secret) so it can't be triggered by anyone who merely knows the URL.
//
// Idempotent and safe to re-invoke: only ever touches rows where
// auth_user_id is still null, so running it twice (or interrupting it
// partway through a large patient list) never creates duplicates or
// re-processes anyone. Processes at most `limit` rows per call (default
// 50 -- each row is 3 sequential network round-trips, so even 50 can take
// a while) to stay well under an Edge Function's execution time limit --
// call it repeatedly (?limit=50, or pass your own) until the response
// reports remainingPatients:0 and remainingGuardians:0.
//
// Required secrets (set once via `supabase secrets set`):
//   SUPABASE_SERVICE_ROLE_KEY -- Project Settings -> API -> service_role.
//   PATIENT_AUTH_MIGRATION_SECRET -- any long random string you choose;
//     pass the same value back as the x-migration-secret header.
// SUPABASE_URL is already present by default.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MIGRATION_SECRET = Deno.env.get("PATIENT_AUTH_MIGRATION_SECRET");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function syntheticEmail(kind: "patient" | "guardian", id: string): string {
  return kind === "guardian" ? `g_${id}@guardians.smartordi.internal` : `p_${id}@patients.smartordi.internal`;
}

async function migrateOne(
  admin: ReturnType<typeof createClient>,
  table: "patients" | "patient_guardians",
  kind: "patient" | "guardian",
  row: { id: string; pw_hash: string },
): Promise<{ id: string; ok: boolean; error?: string }> {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: syntheticEmail(kind, row.id),
    password: crypto.randomUUID(), // placeholder -- overwritten below by the real hash
    email_confirm: true,
    user_metadata: { kind, [`${kind}_id`]: row.id, migrated: true },
  });
  if (createErr || !created?.user) return { id: row.id, ok: false, error: createErr?.message || "create_user_failed" };

  const { error: hashErr } = await admin.rpc("_set_auth_password_hash", {
    p_auth_user_id: created.user.id, p_hash: row.pw_hash,
  });
  if (hashErr) return { id: row.id, ok: false, error: hashErr.message };

  const { error: linkErr } = await admin.from(table).update({ auth_user_id: created.user.id }).eq("id", row.id);
  if (linkErr) return { id: row.id, ok: false, error: linkErr.message };

  return { id: row.id, ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (MIGRATION_SECRET && req.headers.get("x-migration-secret") !== MIGRATION_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Rows with no pw_hash at all (an account that never got a working
  // password to begin with, a known prior bug) are left alone -- they
  // can't log in today either, so this isn't a regression, and staff can
  // fix them the normal way (resetPatientPassword(), which now also
  // provisions a real Auth user via create-patient-auth-user).
  const { data: patientRows, error: patientsErr } = await admin
    .from("patients").select("id, pw_hash")
    .is("auth_user_id", null).not("pw_hash", "is", null).limit(limit);
  if (patientsErr) return json({ error: "fetch_patients_failed", detail: patientsErr.message }, 500);

  const { data: guardianRows, error: guardiansErr } = await admin
    .from("patient_guardians").select("id, pw_hash")
    .is("auth_user_id", null).not("pw_hash", "is", null).limit(limit);
  if (guardiansErr) return json({ error: "fetch_guardians_failed", detail: guardiansErr.message }, 500);

  const patientResults = [];
  for (const row of patientRows || []) {
    patientResults.push(await migrateOne(admin, "patients", "patient", row as { id: string; pw_hash: string }));
  }
  const guardianResults = [];
  for (const row of guardianRows || []) {
    guardianResults.push(await migrateOne(admin, "patient_guardians", "guardian", row as { id: string; pw_hash: string }));
  }

  const { count: remainingPatients } = await admin
    .from("patients").select("id", { count: "exact", head: true })
    .is("auth_user_id", null).not("pw_hash", "is", null);
  const { count: remainingGuardians } = await admin
    .from("patient_guardians").select("id", { count: "exact", head: true })
    .is("auth_user_id", null).not("pw_hash", "is", null);

  return json({
    ok: true,
    patients: { migrated: patientResults.filter((r) => r.ok).length, failed: patientResults.filter((r) => !r.ok) },
    guardians: { migrated: guardianResults.filter((r) => r.ok).length, failed: guardianResults.filter((r) => !r.ok) },
    remainingPatients: remainingPatients ?? 0,
    remainingGuardians: remainingGuardians ?? 0,
  });
});
