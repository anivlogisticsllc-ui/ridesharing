// app/api/billing/membership/activate/route.ts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { renewMembershipForUser } from "@/lib/payments/renewMembershipForUser";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ApiOk = {
  ok: true;
  membership: {
    id: string;
    type: string;
    plan: string;
    status: string;
    startDate: string;
    expiryDate: string;
    amountPaidCents: number;
  };
  charge: {
    id: string;
    amountCents: number;
    currency: string;
    status: string;
    paidAt: string | null;
    stripePaymentIntentId: string | null;
    stripeChargeId: string | null;
  };
};

type ApiErr = { ok: false; error: string };

function jsonError(status: number, error: string) {
  return NextResponse.json<ApiErr>({ ok: false, error }, { status });
}

async function requireUser() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  return userId ? { userId } : null;
}

export async function POST() {
  const auth = await requireUser();
  if (!auth) return jsonError(401, "Not authenticated");

  try {
    const result = await renewMembershipForUser({
      userId: auth.userId,
      reason: "MANUAL_ACTIVATION",
      ignoreAdminGrant: false,
      renewIfAlreadyActive: false,
    });

    if (!result.ok) {
      const status =
        result.reason === "NO_DEFAULT_PAYMENT_METHOD" ||
        result.reason === "NO_STRIPE_CUSTOMER"
          ? 400
          : result.reason === "PAYMENT_FAILED"
          ? 402
          : result.reason === "USER_NOT_FOUND"
          ? 404
          : 400;

      return jsonError(status, result.error);
    }

    if (result.skipped) {
      const message =
        result.reason === "ADMIN_GRANT_ACTIVE"
          ? "Membership is already active through an admin grant."
          : "Membership is already active.";

      return jsonError(409, message);
    }

    const membership = await prisma.membership.findUnique({
      where: { id: result.membershipId },
      select: {
        id: true,
        type: true,
        plan: true,
        status: true,
        startDate: true,
        expiryDate: true,
        amountPaidCents: true,
      },
    });

    const charge = await prisma.membershipCharge.findUnique({
      where: { id: result.membershipChargeId },
      select: {
        id: true,
        amountCents: true,
        currency: true,
        status: true,
        paidAt: true,
        stripePaymentIntentId: true,
        stripeChargeId: true,
      },
    });

    if (!membership || !charge) {
      return jsonError(500, "Membership was renewed, but response data could not be loaded.");
    }

    const response: ApiOk = {
      ok: true,
      membership: {
        id: membership.id,
        type: membership.type,
        plan: membership.plan,
        status: membership.status,
        startDate: membership.startDate.toISOString(),
        expiryDate: membership.expiryDate.toISOString(),
        amountPaidCents: membership.amountPaidCents,
      },
      charge: {
        id: charge.id,
        amountCents: charge.amountCents,
        currency: charge.currency,
        status: charge.status,
        paidAt: charge.paidAt ? charge.paidAt.toISOString() : null,
        stripePaymentIntentId: charge.stripePaymentIntentId ?? null,
        stripeChargeId: charge.stripeChargeId ?? null,
      },
    };

    return NextResponse.json(response);
  } catch (err: any) {
    console.error("POST /api/billing/membership/activate error:", err);
    return jsonError(500, err?.message || "Internal server error");
  }
}