// app/api/billing/membership/activate/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import {
  MembershipChargeStatus,
  MembershipInterval,
  MembershipPlan,
  MembershipStatus,
  MembershipType,
  PaymentMethod,
  UserRole,
} from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRICING_FALLBACK = {
  RIDER_MONTHLY_CENTS: 299,
  DRIVER_MONTHLY_CENTS: 999,
} as const;

type ApiOk = {
  ok: true;
  membership: {
    id: string;
    type: MembershipType;
    plan: MembershipPlan;
    status: MembershipStatus;
    startDate: string;
    expiryDate: string;
    amountPaidCents: number;
  };
  charge: {
    id: string;
    amountCents: number;
    currency: string;
    status: MembershipChargeStatus;
    paidAt: string | null;
    stripePaymentIntentId: string | null;
    stripeChargeId: string | null;
  };
};

type ApiErr = { ok: false; error: string };

function jsonError(status: number, error: string) {
  return NextResponse.json<ApiErr>({ ok: false, error }, { status });
}

function roleToMembershipType(role: UserRole): MembershipType | null {
  if (role === UserRole.RIDER) return MembershipType.RIDER;
  if (role === UserRole.DRIVER) return MembershipType.DRIVER;
  return null;
}

function addInterval(from: Date, interval: MembershipInterval) {
  const d = new Date(from);

  switch (interval) {
    case MembershipInterval.MONTHLY:
      d.setMonth(d.getMonth() + 1);
      return d;
    default:
      d.setMonth(d.getMonth() + 1);
      return d;
  }
}

function latestChargeIdFromPi(pi: any): string | null {
  const latestCharge = pi?.latest_charge;
  if (!latestCharge) return null;
  if (typeof latestCharge === "string") return latestCharge;
  if (typeof latestCharge?.id === "string") return latestCharge.id;
  return null;
}

async function requireUser() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  return userId ? { userId } : null;
}

async function getDefaultPaymentMethodForUser(userId: string): Promise<{
  row: Pick<PaymentMethod, "id" | "stripePaymentMethodId" | "brand" | "last4" | "expMonth" | "expYear"> | null;
  stripeCustomerId: string | null;
  role: UserRole;
} | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      stripeCustomerId: true,
    },
  });

  if (!user) return null;

  const row = await prisma.paymentMethod.findFirst({
    where: {
      userId,
      isDefault: true,
      stripePaymentMethodId: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      stripePaymentMethodId: true,
      brand: true,
      last4: true,
      expMonth: true,
      expYear: true,
    },
  });

  return {
    row,
    stripeCustomerId: user.stripeCustomerId ?? null,
    role: user.role,
  };
}

async function getActivePricing(membershipType: MembershipType) {
  const pricing = await prisma.membershipPricing.findUnique({
    where: { membershipType },
    select: {
      id: true,
      membershipType: true,
      plan: true,
      currency: true,
      amountCents: true,
      interval: true,
      isActive: true,
    },
  });

  if (pricing?.isActive && pricing.amountCents > 0) {
    return pricing;
  }

  return {
    id: null,
    membershipType,
    plan: MembershipPlan.STANDARD,
    currency: "USD",
    amountCents:
      membershipType === MembershipType.DRIVER
        ? PRICING_FALLBACK.DRIVER_MONTHLY_CENTS
        : PRICING_FALLBACK.RIDER_MONTHLY_CENTS,
    interval: MembershipInterval.MONTHLY,
    isActive: true,
  };
}

export async function POST() {
  const auth = await requireUser();
  if (!auth) return jsonError(401, "Not authenticated");

  try {
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: {
        id: true,
        role: true,
        emailVerified: true,
        onboardingCompleted: true,
        stripeCustomerId: true,
      },
    });

    if (!user) return jsonError(404, "User not found");

    const membershipType = roleToMembershipType(user.role);
    if (!membershipType) {
      return jsonError(400, "Membership activation is not supported for this role.");
    }

    if (!user.emailVerified) {
      return jsonError(400, "Please verify your email before activating membership.");
    }

    const paymentInfo = await getDefaultPaymentMethodForUser(user.id);
    if (!paymentInfo) {
      return jsonError(404, "User not found.");
    }

    if (!paymentInfo.row?.stripePaymentMethodId || !paymentInfo.stripeCustomerId) {
      return jsonError(400, "A default card is required before activating membership.");
    }

    const pricing = await getActivePricing(membershipType);

    if (!pricing.amountCents || pricing.amountCents < 50) {
      return jsonError(400, "Membership pricing is not configured correctly.");
    }

    const latestMembership = await prisma.membership.findFirst({
      where: {
        userId: user.id,
        type: membershipType,
      },
      orderBy: { startDate: "desc" },
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

    const now = new Date();

    // Devil's advocate:
    // We do NOT block if the user is currently active paid. We allow renewal/extension.
    // Extension starts from the later of now or current expiry.
    const extensionBase =
      latestMembership?.expiryDate && latestMembership.expiryDate > now
        ? latestMembership.expiryDate
        : now;

    const nextExpiry = addInterval(extensionBase, pricing.interval);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: pricing.amountCents,
      currency: pricing.currency.toLowerCase(),
      customer: paymentInfo.stripeCustomerId,
      payment_method: paymentInfo.row.stripePaymentMethodId,
      confirm: true,
      off_session: true,
      metadata: {
        kind: "membership_activation",
        userId: user.id,
        membershipType,
        pricingPlan: pricing.plan,
      },
    });

    if (paymentIntent.status !== "succeeded") {
      const failedCharge = await prisma.membershipCharge.create({
        data: {
          userId: user.id,
          membershipId: latestMembership?.id ?? null,
          paymentMethodId: paymentInfo.row.id,
          amountCents: pricing.amountCents,
          currency: pricing.currency,
          status: MembershipChargeStatus.FAILED,
          provider: "STRIPE",
          stripePaymentIntentId: paymentIntent.id,
          stripeChargeId: latestChargeIdFromPi(paymentIntent),
          providerRef: paymentIntent.id,
          failedAt: new Date(),
        },
      });

      return NextResponse.json(
        {
          ok: false,
          error: `Membership charge did not succeed (status: ${paymentIntent.status}).`,
          chargeId: failedCharge.id,
        },
        { status: 402 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      let membershipId: string;

      if (latestMembership) {
        const updated = await tx.membership.update({
          where: { id: latestMembership.id },
          data: {
            plan: pricing.plan,
            status: MembershipStatus.ACTIVE,
            amountPaidCents: pricing.amountCents,
            paymentProvider: "STRIPE",
            paymentRef: paymentIntent.id,
            startDate: latestMembership.expiryDate > now ? latestMembership.startDate : now,
            expiryDate: nextExpiry,
          },
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

        membershipId = updated.id;

        const charge = await tx.membershipCharge.create({
          data: {
            userId: user.id,
            membershipId: updated.id,
            paymentMethodId: paymentInfo.row!.id,
            amountCents: pricing.amountCents,
            currency: pricing.currency,
            status: MembershipChargeStatus.SUCCEEDED,
            provider: "STRIPE",
            stripePaymentIntentId: paymentIntent.id,
            stripeChargeId: latestChargeIdFromPi(paymentIntent),
            providerRef: paymentIntent.id,
            paidAt: new Date(),
          },
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

        return { membership: updated, charge };
      }

      const created = await tx.membership.create({
        data: {
          userId: user.id,
          type: membershipType,
          plan: pricing.plan,
          startDate: now,
          expiryDate: nextExpiry,
          status: MembershipStatus.ACTIVE,
          amountPaidCents: pricing.amountCents,
          paymentProvider: "STRIPE",
          paymentRef: paymentIntent.id,
        },
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

      membershipId = created.id;

      const charge = await tx.membershipCharge.create({
        data: {
          userId: user.id,
          membershipId,
          paymentMethodId: paymentInfo.row!.id,
          amountCents: pricing.amountCents,
          currency: pricing.currency,
          status: MembershipChargeStatus.SUCCEEDED,
          provider: "STRIPE",
          stripePaymentIntentId: paymentIntent.id,
          stripeChargeId: latestChargeIdFromPi(paymentIntent),
          providerRef: paymentIntent.id,
          paidAt: new Date(),
        },
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

      return { membership: created, charge };
    });

    const response: ApiOk = {
      ok: true,
      membership: {
        id: result.membership.id,
        type: result.membership.type,
        plan: result.membership.plan,
        status: result.membership.status,
        startDate: result.membership.startDate.toISOString(),
        expiryDate: result.membership.expiryDate.toISOString(),
        amountPaidCents: result.membership.amountPaidCents,
      },
      charge: {
        id: result.charge.id,
        amountCents: result.charge.amountCents,
        currency: result.charge.currency,
        status: result.charge.status,
        paidAt: result.charge.paidAt ? result.charge.paidAt.toISOString() : null,
        stripePaymentIntentId: result.charge.stripePaymentIntentId ?? null,
        stripeChargeId: result.charge.stripeChargeId ?? null,
      },
    };

    return NextResponse.json(response);
  } catch (err: any) {
    console.error("POST /api/billing/membership/activate error:", err);

    const stripeMessage =
      err?.raw?.message ||
      err?.message ||
      "Internal server error";

    return jsonError(500, stripeMessage);
  }
}