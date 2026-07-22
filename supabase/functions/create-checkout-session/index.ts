// ══ Creates a real Stripe Checkout subscription session for a practice's
// chosen plan -- replaces the old fake card-entry form in doctor.html's
// confirmPlanChange(), which collected a card number/IBAN but never
// actually charged anything (see phase26_stripe_billing.sql).
//
// Called by doctor.html's confirmPlanChange() via
// sb.functions.invoke('create-checkout-session', {body:{plan, returnUrl}}).
// The client then redirects window.location.href to the returned url.
//
// Supabase verifies the caller's JWT automatically before this function's
// body ever runs (same as every other Edge Function in this project) --
// this function forwards that SAME Authorization header into its own
// Supabase client (instead of using a service-role key), so every query
// below runs under the caller's own row-level-security context via the
// existing "view own practice"/"update own practice" policies. A request
// can never resolve or touch any practice other than the caller's own,
// regardless of what a request body might claim.
//
// Required secrets (set once via `supabase secrets set`):
//   STRIPE_SECRET_KEY -- Stripe dashboard -> Developers -> API keys.
//   STRIPE_PRICE_BASIC / STRIPE_PRICE_PRO / STRIPE_PRICE_ENTERPRISE
//     -- the recurring Price IDs (price_...) created for each plan in the
//        Stripe dashboard's Product catalog. A plan with no configured
//        price ID is rejected below rather than silently charging the
//        wrong amount.
// SUPABASE_URL / SUPABASE_ANON_KEY are already present in every Edge
// Function's environment by default -- nothing to set for those.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const PRICE_IDS: Record<string, string | undefined> = {
  basic: Deno.env.get("STRIPE_PRICE_BASIC"),
  pro: Deno.env.get("STRIPE_PRICE_PRO"),
  enterprise: Deno.env.get("STRIPE_PRICE_ENTERPRISE"),
};

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

  let body: { plan?: string; returnUrl?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { plan, returnUrl } = body;
  const priceId = plan ? PRICE_IDS[plan] : undefined;
  if (!plan || !priceId) return json({ error: "unknown_or_unconfigured_plan" }, 400);
  if (!returnUrl) return json({ error: "missing_return_url" }, 400);

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
    .from("practices").select("id, stripe_customer_id").eq("id", staff.practice_id).maybeSingle();
  if (practiceErr || !practice) return json({ error: "practice_not_found" }, 404);

  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("client_reference_id", practice.id);
  params.set("metadata[practice_id]", practice.id);
  params.set("metadata[plan]", plan);
  params.set("success_url", `${returnUrl}?checkout=success`);
  params.set("cancel_url", `${returnUrl}?checkout=cancelled`);
  if (practice.stripe_customer_id) {
    params.set("customer", practice.stripe_customer_id);
  } else {
    params.set("customer_creation", "always");
  }

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const stripeData = await stripeRes.json().catch(() => ({}));
  if (!stripeRes.ok) {
    console.error("Stripe checkout session creation failed", stripeRes.status, stripeData);
    return json({ error: "stripe_failed", detail: stripeData?.error?.message }, 502);
  }

  return json({ url: stripeData.url });
});
