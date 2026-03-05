// app/api/billing/payment-method/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

function jsonError(status: number, error: string) {
  return noStoreJson({ ok: false, error }, status);
}

async function requireUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  return typeof userId === "string" && userId.length ? userId : null;
}

function toStr(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

type PMShape = {
  id: string;
  provider: string | null;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  stripePaymentMethodId: string | null;
  updatedAt: string;
};

function shapeFromDb(row: {
  id: string;
  provider: string | null;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  stripePaymentMethodId: string | null;
  updatedAt: Date;
}): PMShape {
  return {
    id: row.id,
    provider: row.provider ?? null,
    brand: row.brand ?? null,
    last4: row.last4 ?? null,
    expMonth: row.expMonth ?? null,
    expYear: row.expYear ?? null,
    stripePaymentMethodId: row.stripePaymentMethodId ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getStripeDefaultCard(
  customerId: string
): Promise<{ paymentMethodId: string; card: Stripe.PaymentMethod.Card } | null> {
  const customerAny = await stripe.customers.retrieve(customerId);
  if (!customerAny || (customerAny as any).deleted) return null;

  const customer = customerAny as Stripe.Customer;

  const defaultPm = customer.invoice_settings?.default_payment_method ?? null;
  const defaultPmId =
    typeof defaultPm === "string"
      ? defaultPm
      : typeof (defaultPm as any)?.id === "string"
        ? (defaultPm as any).id
        : null;

  if (defaultPmId) {
    const pm = await stripe.paymentMethods.retrieve(defaultPmId);
    if (pm && pm.type === "card" && pm.card) {
      return { paymentMethodId: defaultPmId, card: pm.card };
    }
  }

  const list = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
    limit: 1,
  });

  const first = list.data?.[0];
  if (first && first.type === "card" && first.card) {
    return { paymentMethodId: first.id, card: first.card };
  }

  return null;
}

/**
 * Saves/updates a PaymentMethod row and makes it default for the user.
 * Requires Prisma schema to have: @@unique([userId, stripePaymentMethodId])
 */
async function saveDefaultCard(params: {
  userId: string;
  stripePmId: string;
  card: Stripe.PaymentMethod.Card;
}) {
  const { userId, stripePmId, card } = params;

  const provider = "STRIPE";
  const brand = card.brand ?? null;
  const last4 = card.last4 ?? null;
  const expMonth = card.exp_month ?? null;
  const expYear = card.exp_year ?? null;

  return prisma.$transaction(async (tx) => {
    await tx.paymentMethod.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });

    const row = await tx.paymentMethod.upsert({
      where: {
        userId_stripePaymentMethodId: {
          userId,
          stripePaymentMethodId: stripePmId,
        },
      },
      create: {
        userId,
        provider,
        stripePaymentMethodId: stripePmId,
        brand,
        last4,
        expMonth,
        expYear,
        isDefault: true,
      },
      update: {
        provider,
        brand,
        last4,
        expMonth,
        expYear,
        isDefault: true,
      },
      select: {
        id: true,
        provider: true,
        brand: true,
        last4: true,
        expMonth: true,
        expYear: true,
        stripePaymentMethodId: true,
        updatedAt: true,
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: { stripeDefaultPaymentId: stripePmId },
    });

    return row;
  });
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return jsonError(401, "Not authenticated");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, stripeCustomerId: true, stripeDefaultPaymentId: true },
  });
  if (!user) return jsonError(404, "User not found");

  // DB-first: look for default row
  const dbDefault = await prisma.paymentMethod.findFirst({
    where: { userId: user.id, isDefault: true },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      provider: true,
      brand: true,
      last4: true,
      expMonth: true,
      expYear: true,
      stripePaymentMethodId: true,
      updatedAt: true,
    },
  });

  // DB fallback: row matching user.stripeDefaultPaymentId
  const dbFallback =
    !dbDefault && user.stripeDefaultPaymentId
      ? await prisma.paymentMethod.findFirst({
          where: {
            userId: user.id,
            stripePaymentMethodId: user.stripeDefaultPaymentId,
          },
          select: {
            id: true,
            provider: true,
            brand: true,
            last4: true,
            expMonth: true,
            expYear: true,
            stripePaymentMethodId: true,
            updatedAt: true,
          },
        })
      : null;

  const activeDb = dbDefault ?? dbFallback;

  if (activeDb?.stripePaymentMethodId) {
    return noStoreJson({
      ok: true,
      hasPaymentMethod: true,
      customerId: user.stripeCustomerId ?? null,
      defaultPaymentMethod: shapeFromDb(activeDb),
    });
  }

  // Stripe fallback
  if (!user.stripeCustomerId) {
    return noStoreJson({
      ok: true,
      hasPaymentMethod: false,
      customerId: null,
      defaultPaymentMethod: null,
    });
  }

  const stripeCard = await getStripeDefaultCard(user.stripeCustomerId);
  if (!stripeCard) {
    return noStoreJson({
      ok: true,
      hasPaymentMethod: false,
      customerId: user.stripeCustomerId,
      defaultPaymentMethod: null,
    });
  }

  // Self-heal DB
  const saved = await saveDefaultCard({
    userId: user.id,
    stripePmId: stripeCard.paymentMethodId,
    card: stripeCard.card,
  });

  return noStoreJson({
    ok: true,
    hasPaymentMethod: true,
    customerId: user.stripeCustomerId,
    defaultPaymentMethod: shapeFromDb(saved),
  });
}

type PostBody = {
  setupIntentId?: string;
  paymentMethodId?: string; // pm_...
};

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return jsonError(401, "Not authenticated");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, stripeCustomerId: true },
  });
  if (!user) return jsonError(404, "User not found");
  if (!user.stripeCustomerId) {
    return jsonError(400, "Missing Stripe customer. Create setup-intent first.");
  }

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const setupIntentId = toStr(body.setupIntentId);
  const providedPmId = toStr(body.paymentMethodId);

  let stripePmId: string | null = null;

  if (setupIntentId) {
    const si = await stripe.setupIntents.retrieve(setupIntentId);
    const pm = si.payment_method;
    stripePmId = typeof pm === "string" ? pm : pm?.id ?? null;
    if (!stripePmId) return jsonError(400, "SetupIntent has no payment_method.");
  } else if (providedPmId) {
    stripePmId = providedPmId;
  } else {
    return jsonError(400, "Missing setupIntentId or paymentMethodId.");
  }

  const pm = await stripe.paymentMethods.retrieve(stripePmId);
  if (!pm || pm.type !== "card" || !pm.card) {
    return jsonError(400, "Invalid payment method (card required).");
  }

  // Ensure attached to this customer
  if (pm.customer && pm.customer !== user.stripeCustomerId) {
    return jsonError(400, "Payment method belongs to a different customer.");
  }
  if (!pm.customer) {
    await stripe.paymentMethods.attach(stripePmId, { customer: user.stripeCustomerId });
  }

  // Set default on Stripe customer
  await stripe.customers.update(user.stripeCustomerId, {
    invoice_settings: { default_payment_method: stripePmId },
  });

  // Save locally + set as default
  const saved = await saveDefaultCard({
    userId: user.id,
    stripePmId: stripePmId,
    card: pm.card,
  });

  return noStoreJson({
    ok: true,
    hasPaymentMethod: true,
    customerId: user.stripeCustomerId,
    defaultPaymentMethod: shapeFromDb(saved),
  });
}