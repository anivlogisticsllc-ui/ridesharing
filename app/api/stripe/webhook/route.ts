// app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; // needed for raw body signature verification
export const dynamic = "force-dynamic";

function envOrThrow(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function asStringId(x: unknown): string | null {
  if (typeof x === "string" && x.trim()) return x.trim();
  if (x && typeof x === "object" && "id" in x) {
    const id = (x as any).id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  }
  return null;
}

async function resolveUserIdFromSetupIntent(si: Stripe.SetupIntent): Promise<string | null> {
  // 1) Preferred: metadata on SetupIntent (you should set this when creating SI)
  const metaUserId = (si.metadata?.userId || "").trim();
  if (metaUserId) return metaUserId;

  // 2) Fallback: lookup by stripeCustomerId in your DB
  const customerId = asStringId(si.customer);
  if (customerId) {
    const u = await prisma.user.findUnique({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    });
    if (u?.id) return u.id;
  }

  // 3) Last resort: customer.metadata.userId (works only if you set it)
  if (customerId) {
    const customer = (await stripe.customers.retrieve(customerId)) as Stripe.Customer;
    const userId = (customer.metadata?.userId || "").trim();
    if (userId) return userId;
  }

  return null;
}

export async function POST(req: Request) {
  const webhookSecret = envOrThrow("STRIPE_WEBHOOK_SECRET");

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ ok: false, error: "Missing stripe-signature" }, { status: 400 });
  }

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
      case "setup_intent.succeeded": {
        const si = event.data.object as Stripe.SetupIntent;

        const customerId = asStringId(si.customer);
        const paymentMethodId = asStringId(si.payment_method);

        if (!customerId || !paymentMethodId) {
          console.warn("[stripe webhook] setup_intent.succeeded missing ids", {
            hasCustomer: !!customerId,
            hasPaymentMethod: !!paymentMethodId,
            setupIntentId: si.id,
          });
          break;
        }

        const userId = await resolveUserIdFromSetupIntent(si);
        if (!userId) {
          console.warn("[stripe webhook] could not map setup_intent to user", {
            setupIntentId: si.id,
            customerId,
          });
          break;
        }

        const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
        const card = pm.card;

        if (!card) {
          console.warn("[stripe webhook] payment method is not a card; ignoring", {
            setupIntentId: si.id,
            paymentMethodId,
            type: pm.type,
          });
          break;
        }

        // Set default on Stripe customer (useful for subscriptions + future charges)
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: paymentMethodId },
        });

        await prisma.$transaction(async (tx) => {
          // Clear existing defaults
          await tx.paymentMethod.updateMany({
            where: { userId },
            data: { isDefault: false },
          });

          // Upsert the saved card
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

          // Keep user pointers current
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
        // ignore other events
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[stripe webhook] handler failed", { type: event.type, err });
    return NextResponse.json(
      { ok: false, error: err?.message || "Webhook handler failed" },
      { status: 500 }
    );
  }
}