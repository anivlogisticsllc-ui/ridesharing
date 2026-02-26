// app/api/billing/payment-method/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function requireUser() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return null;
  return { userId };
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

function okResponse(payload: any) {
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export async function GET() {
  const auth = await requireUser();
  if (!auth) return jsonError(401, "Not authenticated");

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: {
      id: true,
      stripeCustomerId: true,
      stripeDefaultPaymentId: true,
    },
  });

  if (!user) return jsonError(404, "User not found");

  const pm = await prisma.paymentMethod.findFirst({
    where: { userId: user.id, isDefault: true },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      brand: true,
      last4: true,
      expMonth: true,
      expYear: true,
      stripePaymentMethodId: true,
      provider: true,
      updatedAt: true,
    },
  });

  const fallback =
    !pm && user.stripeDefaultPaymentId
      ? await prisma.paymentMethod.findFirst({
          where: {
            userId: user.id,
            stripePaymentMethodId: user.stripeDefaultPaymentId,
          },
          select: {
            id: true,
            brand: true,
            last4: true,
            expMonth: true,
            expYear: true,
            stripePaymentMethodId: true,
            provider: true,
            updatedAt: true,
          },
        })
      : null;

  const active = pm ?? fallback;

  const defaultPaymentMethod: PMShape | null = active
    ? {
        id: active.id,
        provider: active.provider ?? null,
        brand: active.brand ?? null,
        last4: active.last4 ?? null,
        expMonth: active.expMonth ?? null,
        expYear: active.expYear ?? null,
        stripePaymentMethodId: active.stripePaymentMethodId ?? null,
        updatedAt: active.updatedAt.toISOString(),
      }
    : null;

  return okResponse({
    ok: true,
    hasPaymentMethod: Boolean(defaultPaymentMethod?.stripePaymentMethodId),
    customerId: user.stripeCustomerId ?? null,
    defaultPaymentMethod,
  });
}

type PostBody = {
  setupIntentId?: string;
  paymentMethodId?: string; // Stripe payment method id (pm_...)
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

  // Retrieve PM
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

  // Set default payment method in Stripe
  await stripe.customers.update(user.stripeCustomerId, {
    invoice_settings: { default_payment_method: stripePmId },
  });

  // Update DB: mark only one default
  const card = pm.card;
  const provider = "stripe";
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
    defaultPaymentMethod: {
      id: saved.id,
      provider: saved.provider ?? null,
      brand: saved.brand ?? null,
      last4: saved.last4 ?? null,
      expMonth: saved.expMonth ?? null,
      expYear: saved.expYear ?? null,
      stripePaymentMethodId: saved.stripePaymentMethodId ?? null,
      updatedAt: saved.updatedAt.toISOString(),
    },
  });
}