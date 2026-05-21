// app/api/billing/payment-method/route.ts

import { NextRequest, NextResponse } from "next/server";
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
  isDefault: boolean;
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
  isDefault: boolean;
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
    isDefault: row.isDefault,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function saveDefaultCard(params: {
  userId: string;
  stripePmId: string;
  card: Stripe.PaymentMethod.Card;
}) {
  const { userId, stripePmId, card } = params;

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
        provider: "STRIPE",
        providerPaymentMethodId: stripePmId,
        stripePaymentMethodId: stripePmId,
        brand: card.brand ?? null,
        last4: card.last4 ?? null,
        expMonth: card.exp_month ?? null,
        expYear: card.exp_year ?? null,
        isDefault: true,
      },
      update: {
        provider: "STRIPE",
        providerPaymentMethodId: stripePmId,
        brand: card.brand ?? null,
        last4: card.last4 ?? null,
        expMonth: card.exp_month ?? null,
        expYear: card.exp_year ?? null,
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
        isDefault: true,
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
    if (pm?.type === "card" && pm.card) {
      return { paymentMethodId: defaultPmId, card: pm.card };
    }
  }

  const list = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
    limit: 1,
  });

  const first = list.data[0];
  if (first?.type === "card" && first.card) {
    return { paymentMethodId: first.id, card: first.card };
  }

  return null;
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return jsonError(401, "Not authenticated");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, stripeCustomerId: true, stripeDefaultPaymentId: true },
  });

  if (!user) return jsonError(404, "User not found");

  let cards = await prisma.paymentMethod.findMany({
    where: { userId: user.id, provider: "STRIPE" },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      provider: true,
      brand: true,
      last4: true,
      expMonth: true,
      expYear: true,
      stripePaymentMethodId: true,
      isDefault: true,
      updatedAt: true,
    },
  });

  if (cards.length === 0 && user.stripeCustomerId) {
    const stripeCard = await getStripeDefaultCard(user.stripeCustomerId);

    if (stripeCard) {
      await saveDefaultCard({
        userId: user.id,
        stripePmId: stripeCard.paymentMethodId,
        card: stripeCard.card,
      });

      cards = await prisma.paymentMethod.findMany({
        where: { userId: user.id, provider: "STRIPE" },
        orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
        select: {
          id: true,
          provider: true,
          brand: true,
          last4: true,
          expMonth: true,
          expYear: true,
          stripePaymentMethodId: true,
          isDefault: true,
          updatedAt: true,
        },
      });
    }
  }

  const shapedCards = cards.map(shapeFromDb);
  const defaultPaymentMethod =
    shapedCards.find((card) => card.isDefault) ?? shapedCards[0] ?? null;

  return noStoreJson({
    ok: true,
    hasPaymentMethod: shapedCards.length > 0,
    customerId: user.stripeCustomerId ?? null,
    cards: shapedCards,
    defaultPaymentMethod,
  });
}

type PostBody = {
  setupIntentId?: string;
  paymentMethodId?: string;
};

export async function POST(req: NextRequest) {
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
    return jsonError(400, "Invalid payment method. Card required.");
  }

  if (pm.customer && pm.customer !== user.stripeCustomerId) {
    return jsonError(400, "Payment method belongs to a different customer.");
  }

  if (!pm.customer) {
    await stripe.paymentMethods.attach(stripePmId, {
      customer: user.stripeCustomerId,
    });
  }

  await stripe.customers.update(user.stripeCustomerId, {
    invoice_settings: { default_payment_method: stripePmId },
  });

  const saved = await saveDefaultCard({
    userId: user.id,
    stripePmId,
    card: pm.card,
  });

  return noStoreJson({
    ok: true,
    hasPaymentMethod: true,
    customerId: user.stripeCustomerId,
    cards: [shapeFromDb(saved)],
    defaultPaymentMethod: shapeFromDb(saved),
  });
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return jsonError(401, "Not authenticated");

  const body = await req.json().catch(() => null);
  const paymentMethodId = toStr(body?.paymentMethodId);

  if (!paymentMethodId) return jsonError(400, "Missing paymentMethodId");

  const card = await prisma.paymentMethod.findFirst({
    where: { id: paymentMethodId, userId },
  });

  if (!card) return jsonError(404, "Payment method not found");

  if (card.stripePaymentMethodId) {
    try {
      await stripe.paymentMethods.detach(card.stripePaymentMethodId);
    } catch {
      // non-fatal
    }
  }

  await prisma.paymentMethod.delete({
    where: { id: card.id },
  });

  const nextDefault = await prisma.paymentMethod.findFirst({
    where: { userId, provider: "STRIPE" },
    orderBy: { updatedAt: "desc" },
  });

  await prisma.$transaction(async (tx) => {
    await tx.paymentMethod.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    if (nextDefault) {
      await tx.paymentMethod.update({
        where: { id: nextDefault.id },
        data: { isDefault: true },
      });
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        stripeDefaultPaymentId: nextDefault?.stripePaymentMethodId ?? null,
      },
    });
  });

  return noStoreJson({ ok: true });
}