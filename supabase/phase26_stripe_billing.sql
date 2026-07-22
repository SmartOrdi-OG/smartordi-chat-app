-- ══════════════════════════════════════════════════════════════
-- Phase 26: real Stripe billing
--
-- Replaces the fake "enter a card number, we don't actually charge it
-- (Demo)" flow in doctor.html's Paket-wechseln modal with a real Stripe
-- Checkout subscription. This migration only adds the columns the new
-- Edge Functions (supabase/functions/create-checkout-session,
-- create-billing-portal-session, stripe-webhook) need to track a
-- practice's Stripe identity and subscription state -- it does not touch
-- `payment_method` (jsonb), which is reused as-is: the webhook now fills
-- it in with the card's real brand/last4 straight from Stripe instead of
-- a client-typed number.
--
-- Run this in the Supabase SQL editor for this project
-- (https://ewilgwndhpxibkogxqbk.supabase.co), after phase18.
-- ══════════════════════════════════════════════════════════════

alter table public.practices add column if not exists stripe_customer_id text;
alter table public.practices add column if not exists stripe_subscription_id text;
-- Stripe's own subscription.status values: trialing, active, past_due,
-- canceled, unpaid, incomplete, incomplete_expired, paused. The app only
-- distinguishes "active/trialing" (full access) from everything else
-- (treated the same as an expired trial -- see applyTrialStatus() in
-- doctor.html), so no CHECK constraint restricting the exact value: Stripe
-- may introduce new ones, and this column is never used to gate access on
-- its own anyway (payment_method/plan already does that).
alter table public.practices add column if not exists subscription_status text;

create index if not exists practices_stripe_customer_id_idx on public.practices(stripe_customer_id);
