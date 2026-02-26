// lib/stripe.ts
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("Missing STRIPE_SECRET_KEY");

// Simplest: omit apiVersion to avoid TS mismatch with your installed stripe types.
// If you insist on pinning, uncomment the apiVersion line and keep the cast.
export const stripe = new Stripe(key, {
  // apiVersion: "2024-06-20" as any,
});
