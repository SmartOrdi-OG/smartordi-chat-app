// ══ Emails the platform owner whenever a critical client-side data-load
// failure is logged (supabase/phase46_client_error_log.sql's
// client_error_log table) -- that table alone only solved "the owner CAN
// check for a failure remotely," not "the owner finds out about one without
// remembering to go check." This closes that gap.
//
// Triggered by a Supabase DATABASE WEBHOOK (Dashboard -> Database ->
// Webhooks), NOT called directly by the app -- set this up once, after
// deploying this function:
//   1. `supabase functions deploy notify-client-error`
//   2. Dashboard -> Database -> Webhooks -> Create a new hook:
//        Table: client_error_log, Events: Insert
//        Type: Supabase Edge Functions, Edge Function: notify-client-error
// Supabase signs every Database Webhook request with a valid service-role
// JWT automatically, so this function can stay JWT-verified (the Edge
// Function default) -- no separate shared-secret scheme needed, unlike
// stripe-webhook (which has no Supabase-issued JWT to verify at all, since
// Stripe itself calls it).
//
// Required secrets:
//   RESEND_API_KEY / RESEND_FROM_EMAIL -- same values already used by
//     send-report-email (same Resend account, same verified sender).
//   OWNER_ALERT_EMAIL -- where these alerts should land.
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY -- auto-injected by Supabase
//     into every Edge Function; used here (service-role, bypasses RLS on
//     purpose -- same trust boundary as this function already has by being
//     the one thing allowed to read client_error_log at all) to resolve the
//     bare practice_id/staff_id UUIDs the webhook payload carries into an
//     actual practice name and staff member, so the owner doesn't have to
//     go look either up by hand to know whose report this is.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "Smartordi <onboarding@resend.dev>";
const OWNER_ALERT_EMAIL = Deno.env.get("OWNER_ALERT_EMAIL");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!RESEND_API_KEY || !OWNER_ALERT_EMAIL) {
    console.error("notify-client-error: missing RESEND_API_KEY or OWNER_ALERT_EMAIL");
    return new Response("not configured", { status: 500 });
  }

  // deno-lint-ignore no-explicit-any
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  // Supabase's own Database Webhook payload shape: {type, table, schema,
  // record, old_record}. `record` is the just-inserted client_error_log row.
  const record = payload?.record || {};

  // Best-effort only -- a lookup failure here (e.g. the practice/staff row
  // was since deleted) must never block the alert email itself from going
  // out; falls back to the raw UUID, same as before this existed.
  let practiceName: string | null = null;
  let staffName: string | null = null;
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    if (record.practice_id) {
      const { data } = await admin.from("practices").select("name").eq("id", record.practice_id).maybeSingle();
      practiceName = data?.name || null;
    }
    if (record.staff_id) {
      const { data } = await admin.from("staff_profiles").select("full_name,username").eq("id", record.staff_id).maybeSingle();
      staffName = data ? `${data.full_name || record.staff_id} (${data.username || "-"})` : null;
    }
  } catch (e) {
    console.error("notify-client-error: practice/staff lookup failed", e);
  }

  const subject = `Smartordi: Datenfehler gemeldet (${record.context || "unbekannt"})`;
  const text = [
    `Kontext: ${record.context || "-"}`,
    `Seite: ${record.page || "-"}`,
    `Praxis: ${practiceName || "-"} (${record.practice_id || "-"})`,
    `Konto: ${staffName || "-"} (${record.staff_id || "-"})`,
    `Fehler: ${record.error_message || "-"}`,
    `Zeit: ${record.created_at || "-"}`,
  ].join("\n");

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: [OWNER_ALERT_EMAIL], subject, text }),
  });

  if (!resendRes.ok) {
    const detail = await resendRes.json().catch(() => ({}));
    console.error("Resend send failed", resendRes.status, detail);
    return new Response(JSON.stringify({ error: "resend_failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
