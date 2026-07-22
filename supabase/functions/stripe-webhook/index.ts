// ══ Stripe webhook: keeps practices.plan/subscription_status/
// payment_method in sync with what actually happened in Stripe.
//
// The client redirecting to Stripe Checkout can't be trusted as the
// source of truth on its own -- the tab could close, the network could
// drop, the browser could crash, all *after* Stripe has actually charged
// the card. Stripe calling back here, server-to-server, once the payment
// has genuinely settled is what create-checkout-session's whole flow
// depends on to ever actually activate a plan.
//
// Unlike every other Edge Function in this project, this one has NO
// authenticated Supabase caller at all -- Stripe calls it directly, and
// the ONLY thing establishing trust is the signature verified below. It
// therefore uses the service-role key on purpose, to read/write across
// every practice regardless of RLS (there is no "caller's own practice"
// here; the practice is whichever one Stripe's event says it is).
//
// Required secrets (set once via `supabase secrets set`):
//   STRIPE_SECRET_KEY      -- same value as create-checkout-session.
//   STRIPE_WEBHOOK_SECRET  -- from this endpoint's "Signing secret" once
//                             you register its deployed URL in the Stripe
//                             dashboard (Developers -> Webhooks -> Add
//                             endpoint), for these events:
//                               checkout.session.completed
//                               customer.subscription.updated
//                               customer.subscription.deleted
//   SUPABASE_SERVICE_ROLE_KEY -- Project Settings -> API -> service_role.
//   STRIPE_PRICE_BASIC / STRIPE_PRICE_PRO / STRIPE_PRICE_ENTERPRISE
//                          -- same values as create-checkout-session, used
//                             here only as a fallback to infer the plan
//                             from a session's price if metadata.plan is
//                             ever missing (e.g. a session created outside
//                             this app's own function, from the Stripe
//                             dashboard directly).
//
// IMPORTANT: this function must be deployed with --no-verify-jwt (Stripe
// has no Supabase JWT to send at all) -- see the deploy notes this file
// shipped alongside.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const PRICE_TO_PLAN: Record<string, string> = {};
for (const plan of ["basic", "pro", "enterprise"]) {
  const priceId = Deno.env.get(`STRIPE_PRICE_${plan.toUpperCase()}`);
  if (priceId) PRICE_TO_PLAN[priceId] = plan;
}

// Stripe's signature scheme: header is "t=<unix_ts>,v1=<hex_hmac>[,v1=<hex_hmac>...]"
// (more than one v1 only appears during Stripe's own signing-secret
// rotation window). The signed payload is "<timestamp>.<raw_request_body>"
// -- the RAW body, before any JSON.parse, since re-serializing JSON is not
// guaranteed to reproduce byte-identical output.
async function verifyStripeSignature(rawBody: string, sigHeader: string, secret: string): Promise<boolean> {
  const timestampMatch = sigHeader.match(/t=(\d+)/);
  const v1Signatures = [...sigHeader.matchAll(/v1=([a-f0-9]+)/g)].map((m) => m[1]);
  if (!timestampMatch || v1Signatures.length === 0) return false;

  const timestamp = Number(timestampMatch[1]);
  const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);
  if (ageSeconds > 300) return false; // 5-minute tolerance, same as Stripe's own SDKs -- rejects replayed old payloads.

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = Array.from(new Uint8Array(sigBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return v1Signatures.some((sig) => sig === expected);
}

async function fetchStripe(path: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}` },
  });
  return res.ok ? await res.json() : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!STRIPE_WEBHOOK_SECRET || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_URL) {
    console.error("stripe-webhook: missing required secrets");
    return new Response("not configured", { status: 500 });
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get("Stripe-Signature") || "";
  if (!(await verifyStripeSignature(rawBody, sigHeader, STRIPE_WEBHOOK_SECRET))) {
    console.error("stripe-webhook: invalid or missing signature");
    return new Response("invalid signature", { status: 400 });
  }

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const practiceId: string | undefined = session.client_reference_id || session.metadata?.practice_id;
    if (!practiceId) {
      console.error("checkout.session.completed with no practice_id", session.id);
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // deno-lint-ignore no-explicit-any
    const update: Record<string, any> = {
      stripe_customer_id: session.customer,
      stripe_subscription_id: session.subscription,
      subscription_status: "active",
    };
    const plan = session.metadata?.plan || (session.metadata?.price_id && PRICE_TO_PLAN[session.metadata.price_id]);
    if (plan) update.plan = plan;

    // Best-effort: fetch the card's real brand/last4 from Stripe so
    // Einstellungen shows the actual card on file. If this extra call
    // fails, the subscription above still activates fine -- the UI just
    // keeps showing "no payment method on file" until the next event.
    if (session.subscription) {
      const sub = await fetchStripe(`subscriptions/${session.subscription}?expand[]=default_payment_method`);
      const pm = sub?.default_payment_method;
      if (pm?.card) update.payment_method = { method: "card", brand: pm.card.brand, last4: pm.card.last4 };
    }

    const { error } = await supabase.from("practices").update(update).eq("id", practiceId);
    if (error) console.error("Failed to apply checkout.session.completed", error);
  } else if (event.type === "customer.subscription.updated") {
    const sub = event.data.object;
    const { error } = await supabase.from("practices")
      .update({ subscription_status: sub.status }).eq("stripe_subscription_id", sub.id);
    if (error) console.error("Failed to apply customer.subscription.updated", error);
  } else if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    const { error } = await supabase.from("practices")
      .update({ subscription_status: "canceled", payment_method: null }).eq("stripe_subscription_id", sub.id);
    if (error) console.error("Failed to apply customer.subscription.deleted", error);
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
