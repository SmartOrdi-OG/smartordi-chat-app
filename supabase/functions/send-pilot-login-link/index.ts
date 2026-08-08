// ══ Creates a long-lived, single-use passwordless login link for one
// Pilot-Konto (Arzt oder Sekretär*in, siehe phase53_pilot_account_setup.sql)
// and emails it as a styled button -- so the Pilot-Person never has to see
// or type a username/password at all ══
//
// Not called from the app -- this is a manual, one-time operation WE
// trigger ourselves per Pilot-Konto (Supabase Dashboard's "Invoke" test
// button, or curl), same handoff spirit as running a phaseNN_*.sql file or
// migrate-patients-to-auth. Deliberately gated by a shared secret
// (requires a valid Supabase JWT in Authorization, PLUS this secret) so it
// can't be triggered by anyone who merely knows the URL -- same pattern as
// migrate-patients-to-auth.
//
// The generated link (supabase/functions/pilot-login) is what actually
// carries the long expiry -- see phase60_pilot_login_links.sql's header
// comment for why this doesn't just use Supabase's own magic-link OTP
// directly (its expiry is short and platform-configured, not something
// this function controls per-call).
//
// Required secrets (already set for notify-client-error/notify-consent-
// recorded -- same Resend account/sender, nothing new to configure there):
//   SUPABASE_SERVICE_ROLE_KEY -- Project Settings -> API -> service_role.
//   RESEND_API_KEY / RESEND_FROM_EMAIL
//   PILOT_LOGIN_SECRET -- any long random string you choose; pass the same
//     value back as the x-pilot-secret header when invoking this function.
// SUPABASE_URL is already present by default.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PILOT_LOGIN_SECRET = Deno.env.get("PILOT_LOGIN_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "Smartordi <onboarding@resend.dev>";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function emailHtml(name: string, practiceName: string, loginUrl: string, days: number): string {
  return `<!doctype html><html lang="de"><body style="margin:0;padding:0;background:#f8fafc;font-family:system-ui,sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:32px 24px;">
  <h1 style="font-size:20px;color:#0f172a;margin:0 0 16px;">Ihr Zugang zu SmartOrdi</h1>
  <p style="color:#334155;line-height:1.6;">Hallo ${name},</p>
  <p style="color:#334155;line-height:1.6;">Ihr Pilot-Konto für <strong>${practiceName}</strong> ist bereit. Mit dem Button unten
  melden Sie sich direkt an -- ohne Benutzername oder Passwort einzugeben.</p>
  <div style="text-align:center;margin:32px 0;">
    <a href="${loginUrl}" style="background:#2563eb;color:#ffffff;text-decoration:none;
    padding:14px 32px;border-radius:8px;font-weight:600;display:inline-block;">Jetzt anmelden</a>
  </div>
  <p style="color:#94a3b8;font-size:13px;line-height:1.5;">Dieser Link ist ${days} Tage gültig und kann nur einmal verwendet werden.
  Falls er abgelaufen ist, melden Sie sich einfach bei uns für einen neuen.</p>
</div>
</body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!PILOT_LOGIN_SECRET || req.headers.get("x-pilot-secret") !== PILOT_LOGIN_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!RESEND_API_KEY) return json({ error: "not_configured" }, 500);

  let body: { staffId?: string; days?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const { staffId } = body;
  if (!staffId) return json({ error: "missing_staff_id" }, 400);
  const days = Math.min(30, Math.max(1, Number(body.days) || 14));

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: staff, error: staffErr } = await admin
    .from("staff_profiles").select("id, vorname, nachname, email, practice_id").eq("id", staffId).maybeSingle();
  if (staffErr || !staff) return json({ error: "staff_not_found" }, 404);
  if (!staff.email) return json({ error: "staff_has_no_email" }, 400);

  const { data: practice } = await admin
    .from("practices").select("name").eq("id", staff.practice_id).maybeSingle();

  const token = randomToken();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const { error: insertErr } = await admin
    .from("staff_pilot_login_links").insert({ staff_id: staff.id, token, expires_at: expiresAt });
  if (insertErr) {
    console.error("send-pilot-login-link: insert failed", insertErr);
    return json({ error: "insert_failed", detail: insertErr.message }, 500);
  }

  const loginUrl = `${SUPABASE_URL}/functions/v1/pilot-login?token=${token}`;
  const fullName = `${staff.vorname} ${staff.nachname}`.trim();

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [staff.email],
      subject: "Ihr Zugang zu SmartOrdi",
      html: emailHtml(fullName || "Sie", practice?.name || "Ihre Praxis", loginUrl, days),
    }),
  });
  if (!resendRes.ok) {
    const detail = await resendRes.json().catch(() => ({}));
    console.error("send-pilot-login-link: Resend send failed", resendRes.status, detail);
    return json({ error: "resend_failed" }, 502);
  }

  return json({ ok: true, expiresAt, loginUrl });
});
