// app/api/billing/payment-method/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function okResponse(payload: unknown) {
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

async function requireUser() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  return userId ? { userId } : null;
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
  // 1) Try customer's invoice_settings.default_payment_method
  const customer = (await stripe.customers.retrieve(customerId)) as Stripe.Customer;
  const defaultPm = customer?.invoice_settings?.default_payment_method;

  const defaultPmId =
    typeof defaultPm === "string" ? defaultPm : typeof defaultPm?.id === "string" ? defaultPm.id : null;

  if (defaultPmId) {
    const pm = await stripe.paymentMethods.retrieve(defaultPmId);
    if (pm && pm.type === "card" && pm.card) {
      return { paymentMethodId: defaultPmId, card: pm.card };
    }
  }

  // 2) Fallback: list card payment methods and take the first
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

export async function GET() {
  const auth = await requireUser();
  if (!auth) return jsonError(401, "Not authenticated");

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, stripeCustomerId: true, stripeDefaultPaymentId: true },
  });
  if (!user) return jsonError(404, "User not found");

  // ---- DB FIRST ----
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

  const dbFallback =
    !dbDefault && user.stripeDefaultPaymentId
      ? await prisma.paymentMethod.findFirst({
          where: { userId: user.id, stripePaymentMethodId: user.stripeDefaultPaymentId },
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

  // If DB already has a usable stripePaymentMethodId, return it
  if (activeDb?.stripePaymentMethodId) {
    const shaped = shapeFromDb(activeDb);
    return okResponse({
      ok: true,
      hasPaymentMethod: true,
      customerId: user.stripeCustomerId ?? null,
      defaultPaymentMethod: shaped,
    });
  }

  // ---- STRIPE FALLBACK (fixes your current problem) ----
  if (!user.stripeCustomerId) {
    return okResponse({
      ok: true,
      hasPaymentMethod: false,
      customerId: null,
      defaultPaymentMethod: null,
    });
  }

  const stripeCard = await getStripeDefaultCard(user.stripeCustomerId);

  if (!stripeCard) {
    return okResponse({
      ok: true,
      hasPaymentMethod: false,
      customerId: user.stripeCustomerId,
      defaultPaymentMethod: null,
    });
  }

  // Optional: self-heal DB so future calls don't need Stripe fallback
  const provider = "STRIPE";
  const brand = stripeCard.card.brand ?? null;
  const last4 = stripeCard.card.last4 ?? null;
  const expMonth = stripeCard.card.exp_month ?? null;
  const expYear = stripeCard.card.exp_year ?? null;

  const saved = await prisma.$transaction(async (tx) => {
    await tx.paymentMethod.updateMany({
      where: { userId: user.id, isDefault: true },
      data: { isDefault: false },
    });

    const row = await tx.paymentMethod.upsert({
      where: { stripePaymentMethodId: stripeCard.paymentMethodId },
      create: {
        userId: user.id,
        provider,
        stripePaymentMethodId: stripeCard.paymentMethodId,
        brand,
        last4,
        expMonth,
        expYear,
        isDefault: true,
      } as any,
      update: {
        userId: user.id,
        provider,
        brand,
        last4,
        expMonth,
        expYear,
        isDefault: true,
      } as any,
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
      where: { id: user.id },
      data: { stripeDefaultPaymentId: stripeCard.paymentMethodId },
    });

    return row;
  });

  return okResponse({
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
  const auth = await requireUser();
  if (!auth) return jsonError(401, "Not authenticated");

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, stripeCustomerId: true },
  });
  if (!user) return jsonError(404, "User not found");
  if (!user.stripeCustomerId) return jsonError(400, "Missing Stripe customer. Create setup-intent first.");

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

  const card = pm.card;
  const provider = "STRIPE";
  const brand = card.brand ?? null;
  const last4 = card.last4 ?? null;
  const expMonth = card.exp_month ?? null;
  const expYear = card.exp_year ?? null;

  const saved = await prisma.$transaction(async (tx) => {
    await tx.paymentMethod.updateMany({
      where: { userId: user.id, isDefault: true },
      data: { isDefault: false },
    });

    const row = await tx.paymentMethod.upsert({
      where: { stripePaymentMethodId: stripePmId },
      create: {
        userId: user.id,
        provider,
        stripePaymentMethodId: stripePmId,
        brand,
        last4,
        expMonth,
        expYear,
        isDefault: true,
      } as any,
      update: {
        userId: user.id,
        provider,
        brand,
        last4,
        expMonth,
        expYear,
        isDefault: true,
      } as any,
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
      where: { id: user.id },
      data: { stripeDefaultPaymentId: stripePmId },
    });

    return row;
  });

  return okResponse({
    ok: true,
    hasPaymentMethod: true,
    customerId: user.stripeCustomerId,
    defaultPaymentMethod: shapeFromDb(saved),
  });
}