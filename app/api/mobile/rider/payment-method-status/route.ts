// app/api/mobile/rider/payment-method-status/route.ts

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

const JWT_SECRET = process.env.MOBILE_JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("MOBILE_JWT_SECRET is not configured");
}

const secret = new TextEncoder().encode(JWT_SECRET);

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:8081",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

type MobileJwtPayload = {
  sub?: string;
};

async function getMobileUserId(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("authorization") || "";

  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();

  if (!token) {
    return null;
  }

  try {
    const verified = await jwtVerify(token, secret);
    const payload = verified.payload as MobileJwtPayload;

    return typeof payload.sub === "string" && payload.sub
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

async function getStripeDefaultCard(
  customerId: string
): Promise<{
  paymentMethodId: string;
  card: Stripe.PaymentMethod.Card;
} | null> {
  const customerAny = await stripe.customers.retrieve(customerId);

  if (!customerAny || (customerAny as any).deleted) {
    return null;
  }

  const customer = customerAny as Stripe.Customer;

  const defaultPm =
    customer.invoice_settings?.default_payment_method ?? null;

  const defaultPmId =
    typeof defaultPm === "string"
      ? defaultPm
      : typeof (defaultPm as any)?.id === "string"
        ? (defaultPm as any).id
        : null;

  if (defaultPmId) {
    const pm = await stripe.paymentMethods.retrieve(defaultPmId);

    if (pm?.type === "card" && pm.card) {
      return {
        paymentMethodId: defaultPmId,
        card: pm.card,
      };
    }
  }

  const list = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
    limit: 1,
  });

  const first = list.data[0];

  if (first?.type === "card" && first.card) {
    return {
      paymentMethodId: first.id,
      card: first.card,
    };
  }

  return null;
}

async function saveDefaultCard(params: {
  userId: string;
  stripePmId: string;
  card: Stripe.PaymentMethod.Card;
}) {
  const { userId, stripePmId, card } = params;

  await prisma.$transaction(async (tx) => {
    await tx.paymentMethod.updateMany({
      where: {
        userId,
        isDefault: true,
      },
      data: {
        isDefault: false,
      },
    });

    await tx.paymentMethod.upsert({
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
    });

    await tx.user.update({
      where: {
        id: userId,
      },
      data: {
        stripeDefaultPaymentId: stripePmId,
      },
    });
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function GET(req: NextRequest) {
  const userId = await getMobileUserId(req);

  if (!userId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Not authenticated",
      },
      {
        status: 401,
        headers: corsHeaders,
      }
    );
  }

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        stripeCustomerId: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          error: "User not found",
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    let card = await prisma.paymentMethod.findFirst({
      where: {
        userId,
        provider: "STRIPE",
        stripePaymentMethodId: {
          not: null,
        },
      },
      orderBy: [
        {
          isDefault: "desc",
        },
        {
          updatedAt: "desc",
        },
      ],
      select: {
        brand: true,
        last4: true,
        expMonth: true,
        expYear: true,
        stripePaymentMethodId: true,
        isDefault: true,
      },
    });

    if (!card && user.stripeCustomerId) {
      const stripeCard =
        await getStripeDefaultCard(user.stripeCustomerId);

      if (stripeCard) {
        await saveDefaultCard({
          userId,
          stripePmId: stripeCard.paymentMethodId,
          card: stripeCard.card,
        });

        card = {
          brand: stripeCard.card.brand ?? null,
          last4: stripeCard.card.last4 ?? null,
          expMonth: stripeCard.card.exp_month ?? null,
          expYear: stripeCard.card.exp_year ?? null,
          stripePaymentMethodId: stripeCard.paymentMethodId,
          isDefault: true,
        };
      }
    }

    return NextResponse.json(
      {
        ok: true,
        hasPaymentMethod: Boolean(card?.stripePaymentMethodId),
        card: card
          ? {
              brand: card.brand ?? null,
              last4: card.last4 ?? null,
              expMonth: card.expMonth ?? null,
              expYear: card.expYear ?? null,
            }
          : null,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (err) {
    console.error(
      "[mobile/rider/payment-method-status] error:",
      err
    );

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to load payment method status",
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}