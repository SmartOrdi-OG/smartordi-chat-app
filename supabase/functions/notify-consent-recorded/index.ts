// ══ Emails the platform owner a copy of every new privacy-policy consent
// event, as the actual evidence trail (supabase/phase59_consent_records.sql)
// -- register.html's DSGVO/AGB checkbox and patient-login.html's own AGB/
// Datenschutz checkbox previously only gated their submit button
// client-side; neither write was ever persisted or reported anywhere.
//
// Triggered by a Supabase DATABASE WEBHOOK (Dashboard -> Database ->
// Webhooks), NOT called directly by the app -- same pattern as
// notify-client-error, set this up once after deploying this function:
//   1. `supabase functions deploy notify-consent-recorded`
//   2. Dashboard -> Database -> Webhooks -> Create a new hook:
//        Table: consent_records, Events: Insert
//        Type: Supabase Edge Functions, Edge Function: notify-consent-recorded
// Supabase signs every Database Webhook request with a valid service-role
// JWT automatically, so this function stays JWT-verified (the Edge
// Function default) -- record_consent() itself is the only way a row ever
// lands in consent_records (see that SQL file), so there is no untrusted
// client path into this function at all.
//
// Required secrets (already set for notify-client-error -- same Resend
// account/sender, same owner inbox, nothing new to configure):
//   RESEND_API_KEY / RESEND_FROM_EMAIL, OWNER_ALERT_EMAIL.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "Smartordi <onboarding@resend.dev>";
const OWNER_ALERT_EMAIL = Deno.env.get("OWNER_ALERT_EMAIL");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!RESEND_API_KEY || !OWNER_ALERT_EMAIL) {
    console.error("notify-consent-recorded: missing RESEND_API_KEY or OWNER_ALERT_EMAIL");
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
  // record, old_record}. `record` is the just-inserted consent_records row.
  const record = payload?.record || {};
  const typeLabel = record.consent_type === "doctor_registration" ? "Arzt-Registrierung" : "Patienten-Anmeldung (Beitrittsanfrage)";
  const subject = `Smartordi: Neue Datenschutz-Einwilligung (${typeLabel})`;
  const text = [
    `Typ: ${typeLabel}`,
    `Name: ${record.full_name || "-"}`,
    `E-Mail: ${record.email || "-"}`,
    `Praxis-ID: ${record.practice_id || "-"}`,
    `Datenschutzerklärung Version: ${record.policy_version || "-"}`,
    `Zeitpunkt: ${record.created_at || "-"}`,
    `User-Agent: ${record.user_agent || "-"}`,
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
