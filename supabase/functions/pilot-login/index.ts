// ══ The actual link a Pilot-Konto's "Login"-Button (in the email
// send-pilot-login-link sends) points at ══
//
// Clicked directly by the browser (top-level navigation from an email
// client), so there is no Authorization/JWT at all on this request -- this
// must be deployed with `--no-verify-jwt`:
//   supabase functions deploy pilot-login --no-verify-jwt
// Since that flag also means anyone who finds this URL shape can call it,
// the ?token= value itself is the only thing standing between a random
// guess and a real staff login -- it must stay a long, random,
// single-use, expiring value (see phase60_pilot_login_links.sql, which
// this reads/writes exclusively via the service-role client below).
//
// Deliberately does NOT hand the caller a real Supabase session directly.
// Instead, once our own long-lived token (staff_pilot_login_links) checks
// out, this generates a FRESH, short-lived, genuine Supabase magic link
// via the Admin API (auth.admin.generateLink) and immediately 302-
// redirects the browser to it -- the browser lands back on login.html with
// a real Supabase-issued session in the URL hash, exactly like clicking a
// normal "forgot password" recovery link already does today (see
// login.html's existing onAuthStateChange('PASSWORD_RECOVERY',...) --
// this is the same mechanism, just for a plain sign-in instead of a
// password reset). See login.html's onAuthStateChange('SIGNED_IN',...)
// branch for the client-side half.
//
// Required secrets (already set for create-patient-auth-user -- nothing
// new to configure):
//   SUPABASE_SERVICE_ROLE_KEY -- Project Settings -> API -> service_role.
// SUPABASE_URL is already present by default.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Where Supabase should send the browser back to once the freshly-minted
// magic link is verified -- login.html already knows how to pick up a
// SIGNED_IN session that arrives this way and route to the right dashboard.
const APP_ORIGIN = "https://chat.smartordiog.eu";

function errorPage(message: string): Response {
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SmartOrdi</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.box{max-width:420px;text-align:center}
h1{font-size:20px;margin:0 0 12px}
p{color:#475569;line-height:1.5}</style></head>
<body><div class="box"><h1>Link ungültig oder abgelaufen</h1>
<p>${message} Bitte fordern Sie einen neuen Login-Link an.</p></div></body></html>`;
  return new Response(html, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return errorPage("Es wurde kein Token übergeben.");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: link, error: linkErr } = await admin
    .from("staff_pilot_login_links")
    .select("id, staff_id, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();
  if (linkErr || !link) return errorPage("Dieser Link ist uns nicht bekannt.");
  if (link.used_at) return errorPage("Dieser Link wurde bereits verwendet.");
  if (new Date(link.expires_at).getTime() < Date.now()) return errorPage("Dieser Link ist abgelaufen.");

  // Mark used BEFORE generating the real session, and only proceed if this
  // request is the one that actually flipped it -- guards against the same
  // link being opened twice at once (e.g. an email client's link-preview
  // bot) racing a real click.
  const { data: claimed, error: claimErr } = await admin
    .from("staff_pilot_login_links")
    .update({ used_at: new Date().toISOString() })
    .eq("id", link.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (claimErr || !claimed) return errorPage("Dieser Link wurde bereits verwendet.");

  const { data: staff, error: staffErr } = await admin
    .from("staff_profiles").select("email").eq("id", link.staff_id).maybeSingle();
  if (staffErr || !staff?.email) return errorPage("Zu diesem Link wurde kein Konto gefunden.");

  const { data: generated, error: genErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: staff.email,
    options: { redirectTo: `${APP_ORIGIN}/login.html` },
  });
  if (genErr || !generated?.properties?.action_link) {
    console.error("pilot-login: generateLink failed", genErr);
    return errorPage("Die Anmeldung konnte nicht vorbereitet werden.");
  }

  return new Response(null, { status: 302, headers: { Location: generated.properties.action_link } });
});
