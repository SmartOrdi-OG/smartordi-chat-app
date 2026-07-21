// ══ Receives inbound lab-result e-mails and drops them into a practice's
// "Eingehende Laborergebnisse" inbox ══
//
// A lab's own LIS already e-mails results automatically wherever the
// ordering doctor tells it to -- nothing changes on the lab's side. Each
// practice instead gets its own dedicated inbound address
// (lab-<token>@<inbound domain>, see vendor/staff-accounts.js's
// labInboundEmailAddress()); the doctor gives THAT address to the lab
// once instead of a personal one.
//
// This function is called by the inbound-email provider's webhook (e.g.
// Postmark's "Inbound" parsing, https://postmarkapp.com/support/article/1064),
// NOT by the browser -- the sender has no Supabase session/JWT at all, so
// this must be deployed with `--no-verify-jwt`:
//   supabase functions deploy receive-lab-email --no-verify-jwt
// and the provider's inbound webhook configured to POST here. It also
// needs the practice's inbound domain (see labInboundEmailAddress()) to
// have an MX record pointed at that provider -- both are one-time setup
// steps outside this codebase, done by whoever administers the
// smartordi.eu domain.
//
// Expects Postmark's inbound webhook JSON shape:
//   { From, Subject, OriginalRecipient, Attachments: [{Name, Content, ContentType}] }
// (Content is already base64 -- Postmark decodes MIME for us, so no e-mail
// parsing library is needed here.) Adjust the field names below if a
// different inbound provider is used instead.
//
// Uses the service-role key (bypasses RLS) since there is no staff
// session to satisfy lab_result_uploads' normal "own practice" policies
// with -- see supabase/phase24_lab_result_inbox.sql.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);

function tokenFromRecipient(address: string | undefined): string | null {
  if (!address) return null;
  const local = address.split("@")[0] || "";
  const match = /^lab-(.+)$/.exec(local.trim());
  return match ? match[1] : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: {
    From?: string;
    Subject?: string;
    OriginalRecipient?: string;
    To?: string;
    Attachments?: { Name?: string; Content?: string; ContentType?: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  const token = tokenFromRecipient(body.OriginalRecipient || body.To);
  if (!token) {
    // Nothing we can route this to -- acknowledge so the provider doesn't retry.
    return new Response(JSON.stringify({ ok: true, skipped: "no_token" }), { status: 200 });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: practice, error: practiceErr } = await sb
    .from("practices")
    .select("id")
    .eq("lab_email_token", token)
    .maybeSingle();
  if (practiceErr || !practice) {
    console.error("receive-lab-email: no practice for token", token, practiceErr);
    return new Response(JSON.stringify({ ok: true, skipped: "unknown_token" }), { status: 200 });
  }

  const attachments = (body.Attachments || []).filter(
    (a) => a.Content && a.ContentType && ALLOWED_MIME.has(a.ContentType)
  );
  if (attachments.length === 0) {
    return new Response(JSON.stringify({ ok: true, skipped: "no_attachments" }), { status: 200 });
  }

  const rows = attachments.map((a) => ({
    practice_id: practice.id,
    patient_name: body.Subject || null,
    sender_email: body.From || null,
    subject: body.Subject || null,
    filename: a.Name || "laborbefund",
    mime_type: a.ContentType,
    file_data: a.Content,
    status: "pending",
  }));

  const { error: insertErr } = await sb.from("lab_result_uploads").insert(rows);
  if (insertErr) {
    console.error("receive-lab-email: insert failed", insertErr);
    return new Response(JSON.stringify({ error: "insert_failed" }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, inserted: rows.length }), { status: 200 });
});
