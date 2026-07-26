// ══ Provisions (or repairs) a real Supabase Auth user for a patient or
// guardian, as part of replacing the hand-rolled patient_sessions/
// guardian_sessions opaque-token mechanism with real Supabase Auth ══
//
// Called by secretary.html (createPatientAccount(), createChildPatientAccount(),
// approveJoinRequest(), resetPatientPassword()) via
// sb.functions.invoke('create-patient-auth-user', {body:{kind, id, password}}).
// Since Supabase Auth requires an email/phone identifier but patients only
// ever have a staff-assigned username, this mints a deterministic,
// never-shown synthetic email from the row's own id -- see
// supabase/phase31_patient_auth.sql's header comment for the full
// reasoning. The login screen itself still only ever asks for
// username + password (see patient-login.html's later rewiring).
//
// Accepts EITHER a plaintext `password` (a staff-generated temp password,
// or a patient's own self-chosen one relayed as plaintext) OR an
// `existingHash` (an already-bcrypt-hashed password this device never saw
// in plaintext -- e.g. a patient who self-registered on their own device,
// see approveJoinRequest()). Idempotent: if the patient/guardian row
// already has an auth_user_id, this updates that existing Auth user's
// password instead of creating a duplicate.
//
// Uses the service-role key for the actual auth.admin.* calls (this is the
// one thing Supabase's client SDK can never do from patient.html/
// secretary.html directly), but first verifies the CALLER is a real
// authenticated staff member via their own forwarded JWT -- a service-role
// action must never trust a request body's claims alone (same principle
// create-checkout-session already follows for its own RLS-scoped calls,
// just adapted here since this function specifically needs service-role).
//
// Required secrets (set once via `supabase secrets set`):
//   SUPABASE_SERVICE_ROLE_KEY -- Project Settings -> API -> service_role.
// SUPABASE_URL/SUPABASE_ANON_KEY are already present by default.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

function syntheticEmail(kind: "patient" | "guardian", id: string): string {
  return kind === "guardian" ? `g_${id}@guardians.smartordi.internal` : `p_${id}@patients.smartordi.internal`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { kind?: string; id?: string; password?: string; existingHash?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { kind, id, password, existingHash } = body;
  if (kind !== "patient" && kind !== "guardian") return json({ error: "invalid_kind" }, 400);
  if (!id) return json({ error: "missing_id" }, 400);
  if (!password && !existingHash) return json({ error: "missing_password_or_hash" }, 400);

  // Verify the CALLER is a real authenticated staff member -- forwards
  // their own JWT into an anon-scoped client (same pattern
  // create-checkout-session already uses) rather than trusting the
  // request body alone, before ever touching the service-role client.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "not_authenticated" }, 401);
  const { data: staff, error: staffErr } = await callerClient
    .from("staff_profiles").select("id").eq("id", userData.user.id).maybeSingle();
  if (staffErr || !staff) return json({ error: "caller_is_not_staff" }, 403);

  const table = kind === "guardian" ? "patient_guardians" : "patients";
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: row, error: rowErr } = await admin
    .from(table).select("auth_user_id").eq("id", id).maybeSingle();
  if (rowErr || !row) return json({ error: "row_not_found" }, 404);

  let authUserId: string | null = row.auth_user_id;

  if (!authUserId) {
    // No real Auth user yet -- create one. When only a hash is available
    // (no plaintext seen by this device), createUser still requires SOME
    // password argument; it's overwritten immediately below by the real
    // hash, so this placeholder is never actually usable by anyone.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: syntheticEmail(kind as "patient" | "guardian", id),
      password: password || crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { kind, [`${kind}_id`]: id },
    });
    if (createErr || !created?.user) {
      console.error("create-patient-auth-user: createUser failed", createErr);
      return json({ error: "create_user_failed", detail: createErr?.message }, 500);
    }
    authUserId = created.user.id;
    const { error: linkErr } = await admin.from(table).update({ auth_user_id: authUserId }).eq("id", id);
    if (linkErr) {
      console.error("create-patient-auth-user: linking auth_user_id failed", linkErr);
      return json({ error: "link_failed" }, 500);
    }
  } else if (password) {
    const { error: updateErr } = await admin.auth.admin.updateUserById(authUserId, { password });
    if (updateErr) {
      console.error("create-patient-auth-user: updateUserById failed", updateErr);
      return json({ error: "update_password_failed", detail: updateErr.message }, 500);
    }
  }

  if (existingHash) {
    const { error: hashErr } = await admin.rpc("_set_auth_password_hash", {
      p_auth_user_id: authUserId, p_hash: existingHash,
    });
    if (hashErr) {
      console.error("create-patient-auth-user: hash copy failed", hashErr);
      return json({ error: "hash_copy_failed" }, 500);
    }
  }

  return json({ ok: true, authUserId });
});
