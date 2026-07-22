// ══ Lets an already-subscribed practice manage/update their payment
// method or cancel, via Stripe's own hosted Billing Portal -- avoids
// re-implementing "update your card" inside this app (which would put us
// right back to handling raw card data ourselves, the exact thing
// Checkout/the Portal exist to keep this app from ever touching).
//
// Called by doctor.html's manageBilling() via
// sb.functions.invoke('create-billing-portal-session', {body:{returnUrl}}).
//
// Same caller-scoped-client approach as create-checkout-session (see its
// comment for why) -- see that file for the shared reasoning.
//
// Required secret: STRIPE_SECRET_KEY (same value as create-checkout-session).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY not configured" }, 500);

  let body: { returnUrl?: string };
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
    .from("practices").select("stripe_customer_id").eq("id", staff.practice_id).maybeSingle();
  if (practiceErr || !practice) return json({ error: "practice_not_found" }, 404);
  if (!practice.stripe_customer_id) return json({ error: "no_stripe_customer_yet" }, 409);

  const params = new URLSearchParams();
  params.set("customer", practice.stripe_customer_id);
  params.set("return_url", body.returnUrl);

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
