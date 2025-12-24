// lib/stripe.ts
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("Missing STRIPE_SECRET_KEY");

export const stripe = new Stripe(key, {
  apiVersion: "2025-01-27.acacia", // if this errors, remove apiVersion and retry
});
