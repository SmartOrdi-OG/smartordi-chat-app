// ══ Sends a real email with a PDF attachment via Resend ══
//
// Called by doctor.html's sendKarteiReport() (the "Bericht senden" modal)
// whenever "Per E-Mail senden" is ticked.
//
// Supabase verifies the caller's JWT automatically before this function's
// body ever runs (the default for a deployed Edge Function, unless deployed
// with --no-verify-jwt) -- same as every RLS-protected table in this app, so
// no separate auth check is needed here: only an already-logged-in staff
// member's own session can reach this code at all.
//
// CORS headers are NOT added automatically by Supabase for Edge Functions
// (unlike the auto-generated REST/RLS endpoints) -- a browser calling this
// via sb.functions.invoke() sends a preflight OPTIONS request first, and
// without an explicit response to it the browser blocks the real POST
// before it ever reaches this code at all, surfacing as a generic
// "fehlgeschlagen" with no useful detail on the frontend.
//
// Required secrets (set once via `supabase secrets set`, see the deploy
// notes this function shipped alongside):
//   RESEND_API_KEY   -- from the Resend dashboard's API Keys page.
//   RESEND_FROM_EMAIL -- optional, defaults to Resend's own sandbox sender
//                        (onboarding@resend.dev), which Resend only lets you
//                        send to the account's own verified address. Real
//                        patient/doctor delivery needs a verified sending
//                        domain in Resend, then this set to e.g.
//                        "Smartordi <no-reply@smartordi.chat.eu>".

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "Smartordi <onboarding@resend.dev>";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let body: { toEmail?: string; subject?: string; bodyText?: string; filename?: string; pdfBase64?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { toEmail, subject, bodyText, filename, pdfBase64 } = body;
  if (!toEmail || !subject || !filename || !pdfBase64) {
    return new Response(JSON.stringify({ error: "missing_fields" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [toEmail],
      subject,
      text: bodyText || "Im Anhang finden Sie den angeforderten Bericht.",
      attachments: [{ filename, content: pdfBase64 }],
    }),
  });

  const resendData = await resendRes.json().catch(() => ({}));
  if (!resendRes.ok) {
    console.error("Resend send failed", resendRes.status, resendData);
    return new Response(JSON.stringify({ error: "resend_failed", detail: resendData }), {
      status: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, id: resendData.id }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
