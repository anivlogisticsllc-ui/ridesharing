// app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; // important for raw body + signature verification
export const dynamic = "force-dynamic";

function envOrThrow(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: Request) {
  const webhookSecret = envOrThrow("STRIPE_WEBHOOK_SECRET");

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ ok: false, error: "Missing stripe-signature" }, { status: 400 });

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `Webhook signature verification failed: ${err?.message || String(err)}` },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      // This is the “card saved” moment
      case "setup_intent.succeeded": {
        const si = event.data.object as Stripe.SetupIntent;

        const customerId = typeof si.customer === "string" ? si.customer : si.customer?.id;
        const paymentMethodId =
          typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;

        if (!customerId || !paymentMethodId) break;

        // Map Stripe customer -> your userId (you set metadata.userId on customer in setup-intent route)
        const customer = (await stripe.customers.retrieve(customerId)) as Stripe.Customer;
        const userId = (customer.metadata?.userId || "").trim();
        if (!userId) break;

        // Pull card details
        const pm = await stripe.paymentMethods.retrieve(paymentMethodId);

        // We only persist cards here (PaymentElement can support others; add cases later if needed)
        const card = pm.card;
        if (!card) break;

        // Make it default on Stripe customer (useful later for subscriptions)
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: paymentMethodId },
        });

        // Persist locally
        await prisma.$transaction(async (tx) => {
          // Turn off old defaults
          await tx.paymentMethod.updateMany({
            where: { userId },
            data: { isDefault: false },
          });

          // Upsert the new/default card
          await tx.paymentMethod.upsert({
            where: { stripePaymentMethodId: paymentMethodId },
            create: {
              userId,
              provider: "STRIPE",
              stripePaymentMethodId: paymentMethodId,
              providerPaymentMethodId: paymentMethodId,
              brand: card.brand ?? null,
              last4: card.last4 ?? null,
              expMonth: card.exp_month ?? null,
              expYear: card.exp_year ?? null,
              isDefault: true,
            },
            update: {
              userId,
              provider: "STRIPE",
              providerPaymentMethodId: paymentMethodId,
              brand: card.brand ?? null,
              last4: card.last4 ?? null,
              expMonth: card.exp_month ?? null,
              expYear: card.exp_year ?? null,
              isDefault: true,
            },
          });

          await tx.user.update({
            where: { id: userId },
            data: {
              stripeCustomerId: customerId,
              stripeDefaultPaymentId: paymentMethodId,
            },
          });
        });

        break;
      }

      default:
        // ignore other events for now
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[stripe webhook]", event.type, err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Webhook handler failed" },
      { status: 500 }
    );
  }
}
