// ══ Lets an already-subscribed practice manage/update their payment
// method or cancel, via Stripe's own hosted Billing Portal -- avoids
// re-implementing "update your card" inside this app (which would put us
// right back to handling raw card data ourselves, the exact thing
// Checkout/the Portal exist to keep this app from ever touching).
//
// Called two ways by doctor.html:
//   manageBilling(): sb.functions.invoke('create-billing-portal-session', {body:{returnUrl}})
//     -- opens the Portal's normal home (update card, view invoices, cancel).
//   confirmPlanChange(), for an ALREADY-subscribed practice only:
//     sb.functions.invoke('create-billing-portal-session', {body:{plan, returnUrl}})
//     -- opens the Portal's "confirm subscription update" flow directly,
//        pre-loaded with the target plan's price. This is the fix for a
//        real billing bug found in a launch-readiness review (2026-07-30):
//        create-checkout-session's `mode: "subscription"` ALWAYS starts a
//        brand-new Stripe subscription, even for a customer who already has
//        one -- confirmPlanChange() used to call it unconditionally for
//        every plan change, so a practice's second (or later) plan switch
//        silently left them with TWO active subscriptions, both billing.
//        Routing an existing subscriber through this flow instead updates
//        their ONE existing subscription's price directly; the resulting
//        customer.subscription.updated webhook event (see
//        supabase/functions/stripe-webhook) is what actually applies the
//        new `plan` here, same as checkout.session.completed does for a
//        brand-new subscriber.
//
// Same caller-scoped-client approach as create-checkout-session (see its
// comment for why) -- see that file for the shared reasoning.
//
// Required secrets: STRIPE_SECRET_KEY (same value as create-checkout-session);
// STRIPE_PRICE_STANDARD / STRIPE_PRICE_ENTERPRISE / STRIPE_PRICE_ENTERPRISE_ANNUAL
// (same values as create-checkout-session), only needed for the plan-switch path.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const PRICE_IDS: Record<string, string | undefined> = {
  standard: Deno.env.get("STRIPE_PRICE_STANDARD"),
  enterprise: Deno.env.get("STRIPE_PRICE_ENTERPRISE"),
  enterprise_annual: Deno.env.get("STRIPE_PRICE_ENTERPRISE_ANNUAL"),
};
// Real security hardening (2026-08-20) -- see create-patient-auth-user's own
// comment on this same change for the full reasoning: was a flat "*",
// scoped down to this app's real origins (defense-in-depth only, since these
// calls are Bearer-token authenticated, never cookie-based).
const PRODUCTION_ORIGIN = "https://chat.smartordiog.eu";
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const allow = origin === PRODUCTION_ORIGIN || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)
    ? origin
    : PRODUCTION_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req: Request) => {
  const CORS_HEADERS = corsHeadersFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY not configured" }, 500);

  let body: { returnUrl?: string; plan?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body.returnUrl) return json({ error: "missing_return_url" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "not_authenticated" }, 401);

  const { data: staff, error: staffErr } = await supabase
    .from("staff_profiles").select("practice_id").eq("id", userData.user.id).maybeSingle();
  if (staffErr || !staff?.practice_id) return json({ error: "no_practice_for_caller" }, 403);

  const { data: practice, error: practiceErr } = await supabase
    .from("practices").select("stripe_customer_id, stripe_subscription_id").eq("id", staff.practice_id).maybeSingle();
  if (practiceErr || !practice) return json({ error: "practice_not_found" }, 404);
  if (!practice.stripe_customer_id) return json({ error: "no_stripe_customer_yet" }, 409);

  const params = new URLSearchParams();
  params.set("customer", practice.stripe_customer_id);
  params.set("return_url", body.returnUrl);

  if (body.plan) {
    const priceId = PRICE_IDS[body.plan];
    if (!priceId) return json({ error: "unknown_or_unconfigured_plan" }, 400);
    if (!practice.stripe_subscription_id) return json({ error: "no_active_subscription" }, 409);

    // Need the CURRENT subscription item's id -- Stripe's "update" flow
    // replaces a specific item's price, it doesn't take just a subscription
    // id on its own.
    const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${practice.stripe_subscription_id}`, {
      headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}` },
    });
    const sub = await subRes.json().catch(() => ({}));
    const itemId = sub?.items?.data?.[0]?.id;
    if (!subRes.ok || !itemId) {
      console.error("Failed to look up subscription item for plan switch", subRes.status, sub);
      return json({ error: "subscription_lookup_failed" }, 502);
    }

    params.set("flow_data[type]", "subscription_update_confirm");
    params.set("flow_data[subscription_update_confirm][subscription]", practice.stripe_subscription_id);
    params.set("flow_data[subscription_update_confirm][items][0][id]", itemId);
    params.set("flow_data[subscription_update_confirm][items][0][price]", priceId);
  }

  const stripeRes = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const stripeData = await stripeRes.json().catch(() => ({}));
  if (!stripeRes.ok) {
    console.error("Stripe billing portal session creation failed", stripeRes.status, stripeData);
    return json({ error: "stripe_failed", detail: stripeData?.error?.message }, 502);
  }

  return json({ url: stripeData.url });
});
