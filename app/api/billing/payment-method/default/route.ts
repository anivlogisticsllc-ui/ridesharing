// app/api/billing/payment-method/default/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function requireUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  return userId || null;
}

export async function POST(req: NextRequest) {
  const userId = await requireUserId();

  if (!userId) return jsonError(401, "Not authenticated");

  const body = await req.json().catch(() => null);
  const paymentMethodId =
    typeof body?.paymentMethodId === "string" ? body.paymentMethodId : "";

  if (!paymentMethodId) return jsonError(400, "Missing paymentMethodId");

  const paymentMethod = await prisma.paymentMethod.findFirst({
    where: {
      id: paymentMethodId,
      userId,
    },
  });

  if (!paymentMethod) return jsonError(404, "Payment method not found");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.paymentMethod.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    await tx.paymentMethod.update({
      where: { id: paymentMethod.id },
      data: { isDefault: true },
    });

    await tx.user.update({
      where: { id: userId },
      data: {
        stripeDefaultPaymentId: paymentMethod.stripePaymentMethodId ?? null,
      },
    });
  });

  if (user?.stripeCustomerId && paymentMethod.stripePaymentMethodId) {
    await stripe.customers.update(user.stripeCustomerId, {
      invoice_settings: {
        default_payment_method: paymentMethod.stripePaymentMethodId,
      },
    });
  }

  return NextResponse.json({ ok: true });
}