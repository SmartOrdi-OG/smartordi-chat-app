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
// Called by cloudflare/email-worker (Cloudflare Email Routing -> a Worker
// that parses the raw MIME message with postal-mime and POSTs the result
// here), NOT by the browser -- the sender has no Supabase session/JWT at
// all, so this must be deployed with `--no-verify-jwt`:
//   supabase functions deploy receive-lab-email --no-verify-jwt
// Since that flag also means anyone who finds this URL can POST to it
// directly, every request must additionally carry the shared secret
// (LAB_EMAIL_WEBHOOK_SECRET) the Worker was configured with.
//
// Expects: { to, from, subject, attachments: [{filename, contentType, content}] }
// (content is already base64 -- the Worker decodes MIME for us).
//
// Uses the service-role key (bypasses RLS) since there is no staff
// session to satisfy lab_result_uploads' normal "own practice" policies
// with -- see supabase/phase24_lab_result_inbox.sql.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("LAB_EMAIL_WEBHOOK_SECRET");

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

  if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  let body: {
    to?: string;
    from?: string;
    subject?: string;
    attachments?: { filename?: string; content?: string; contentType?: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  const token = tokenFromRecipient(body.to);
  if (!token) {
    // Nothing we can route this to -- acknowledge so the Worker doesn't retry forever.
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

  const attachments = (body.attachments || []).filter(
    (a) => a.content && a.contentType && ALLOWED_MIME.has(a.contentType)
  );
  if (attachments.length === 0) {
    return new Response(JSON.stringify({ ok: true, skipped: "no_attachments" }), { status: 200 });
  }

  const rows = attachments.map((a) => ({
    practice_id: practice.id,
    patient_name: body.subject || null,
    sender_email: body.from || null,
    subject: body.subject || null,
    filename: a.filename || "laborbefund",
    mime_type: a.contentType,
    file_data: a.content,
    status: "pending",
  }));

  const { error: insertErr } = await sb.from("lab_result_uploads").insert(rows);
  if (insertErr) {
    console.error("receive-lab-email: insert failed", insertErr);
    return new Response(JSON.stringify({ error: "insert_failed" }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, inserted: rows.length }), { status: 200 });
});
