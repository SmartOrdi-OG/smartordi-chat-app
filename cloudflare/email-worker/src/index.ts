// ══ Cloudflare Email Worker: catches inbound lab-result e-mails for free ══
//
// Chosen over a paid inbound-email provider (Postmark's Inbound parsing
// requires its Pro tier and up) specifically because Cloudflare Email
// Routing + Workers is free for this volume -- the tradeoff is that
// nothing parses the raw MIME message for us, so this Worker does that
// itself (via postal-mime) before forwarding a clean JSON payload to the
// existing supabase/functions/receive-lab-email Edge Function.
//
// One-time setup outside this codebase (done in the Cloudflare dashboard,
// for whoever administers the smartordi.eu domain):
//   1. Add smartordi.eu to Cloudflare (if not already) and add the
//      "labs" subdomain's Email Routing MX/TXT records (Cloudflare adds
//      these for you when you enable Email Routing for the zone).
//   2. Deploy this Worker: `wrangler deploy` from this directory.
//   3. `wrangler secret put LAB_EMAIL_WEBHOOK_SECRET` -- any random
//      string, must match the same-named secret set on the Supabase
//      function (`supabase secrets set LAB_EMAIL_WEBHOOK_SECRET=...`).
//   4. Email → Email Routing → Routing rules → add a rule: catch-all (or
//      `lab-*@labs.smartordi.eu`) → Action "Send to a Worker" → this one.
//
// Attachments over MAX_ATTACHMENT_BYTES are silently dropped -- same 8 MB
// cap the rest of the app already enforces on doctor-uploaded documents
// (doctor.html's handleClinicAttach).

import PostalMime from "postal-mime";

const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

interface Env {
  RECEIVE_LAB_EMAIL_URL: string;
  LAB_EMAIL_WEBHOOK_SECRET: string;
}

// btoa(String.fromCharCode(...bytes)) blows the call stack on large
// files -- chunk it instead.
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext) {
    const email = await PostalMime.parse(message.raw);

    const attachments = (email.attachments || [])
      .filter((a) => a.mimeType && ALLOWED_MIME.has(a.mimeType) && a.content.byteLength <= MAX_ATTACHMENT_BYTES)
      .map((a) => ({
        filename: a.filename || "laborbefund",
        contentType: a.mimeType,
        content: arrayBufferToBase64(a.content as ArrayBuffer),
      }));

    if (attachments.length === 0) return;

    await fetch(env.RECEIVE_LAB_EMAIL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": env.LAB_EMAIL_WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        to: message.to,
        from: message.from,
        subject: email.subject || "",
        attachments,
      }),
    });
  },
};
