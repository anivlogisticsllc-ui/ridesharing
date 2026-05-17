// FILE: lib/payments/renewMembershipForUser.ts

import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import {
  MembershipChargeStatus,
  MembershipPlan,
  MembershipStatus,
  MembershipType,
  UserRole,
} from "@prisma/client";

const PRICING_FALLBACK = {
  RIDER_MONTHLY_CENTS: 299,
  DRIVER_MONTHLY_CENTS: 999,
} as const;

type RenewReason = "MANUAL_ACTIVATION" | "AUTO_RENEWAL" | "ADMIN_RETRY";

export type RenewMembershipResult =
  | {
      ok: true;
      charged: true;
      skipped: false;
      membershipId: string;
      membershipChargeId: string;
      stripePaymentIntentId: string;
      amountCents: number;
      periodStart: string;
      periodEnd: string;
    }
  | {
      ok: true;
      charged: false;
      skipped: true;
      reason: "ADMIN_GRANT_ACTIVE" | "MEMBERSHIP_ALREADY_ACTIVE";
      activeUntil: string | null;
    }
  | {
      ok: false;
      charged: false;
      skipped: false;
      reason:
        | "USER_NOT_FOUND"
        | "UNSUPPORTED_ROLE"
        | "NO_STRIPE_CUSTOMER"
        | "NO_DEFAULT_PAYMENT_METHOD"
        | "PAYMENT_FAILED";
      error: string;
      membershipChargeId?: string;
    };

function addOneMonth(from: Date) {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d;
}

function toIso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

function roleToMembershipType(role: UserRole): MembershipType | null {
  if (role === UserRole.RIDER) return MembershipType.RIDER;
  if (role === UserRole.DRIVER) return MembershipType.DRIVER;
  return null;
}

async function priceForMembershipType(type: MembershipType): Promise<number> {
  const pricing = await prisma.membershipPricing.findUnique({
    where: { membershipType: type },
    select: {
      amountCents: true,
      isActive: true,
    },
  });

  if (pricing?.isActive && typeof pricing.amountCents === "number" && pricing.amountCents > 0) {
    return pricing.amountCents;
  }

  return type === MembershipType.DRIVER
    ? PRICING_FALLBACK.DRIVER_MONTHLY_CENTS
    : PRICING_FALLBACK.RIDER_MONTHLY_CENTS;
}

export async function renewMembershipForUser(args: {
  userId: string;
  reason: RenewReason;
  ignoreAdminGrant?: boolean;
  renewIfAlreadyActive?: boolean;
}): Promise<RenewMembershipResult> {
  const now = new Date();

  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: {
      id: true,
      role: true,
      stripeCustomerId: true,
      freeMembershipEndsAt: true,
    },
  });

  if (!user) {
    return {
      ok: false,
      charged: false,
      skipped: false,
      reason: "USER_NOT_FOUND",
      error: "User not found.",
    };
  }

  const membershipType = roleToMembershipType(user.role);

  if (!membershipType) {
    return {
      ok: false,
      charged: false,
      skipped: false,
      reason: "UNSUPPORTED_ROLE",
      error: "Only rider and driver memberships can be renewed.",
    };
  }

  const adminGrantActive =
    user.freeMembershipEndsAt instanceof Date && user.freeMembershipEndsAt.getTime() > now.getTime();

  if (adminGrantActive && !args.ignoreAdminGrant) {
    return {
      ok: true,
      charged: false,
      skipped: true,
      reason: "ADMIN_GRANT_ACTIVE",
      activeUntil: toIso(user.freeMembershipEndsAt),
    };
  }

  const latestMembership = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      type: membershipType,
    },
    orderBy: {
      expiryDate: "desc",
    },
    select: {
      id: true,
      expiryDate: true,
      status: true,
      plan: true,
    },
  });

  const latestActive =
    latestMembership?.status === MembershipStatus.ACTIVE &&
    latestMembership.expiryDate.getTime() > now.getTime();

  if (latestActive && !args.renewIfAlreadyActive) {
    return {
      ok: true,
      charged: false,
      skipped: true,
      reason: "MEMBERSHIP_ALREADY_ACTIVE",
      activeUntil: toIso(latestMembership.expiryDate),
    };
  }

  if (!user.stripeCustomerId) {
    return {
      ok: false,
      charged: false,
      skipped: false,
      reason: "NO_STRIPE_CUSTOMER",
      error: "User does not have a Stripe customer ID.",
    };
  }

  const paymentMethod = await prisma.paymentMethod.findFirst({
    where: {
      userId: user.id,
      isDefault: true,
      provider: "STRIPE",
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      stripePaymentMethodId: true,
      providerPaymentMethodId: true,
    },
  });

  const stripePaymentMethodId =
    paymentMethod?.stripePaymentMethodId || paymentMethod?.providerPaymentMethodId || null;

  if (!paymentMethod || !stripePaymentMethodId) {
    return {
      ok: false,
      charged: false,
      skipped: false,
      reason: "NO_DEFAULT_PAYMENT_METHOD",
      error: "No default Stripe payment method found.",
    };
  }

  const amountCents = await priceForMembershipType(membershipType);

  const periodStart =
    latestMembership?.expiryDate && latestMembership.expiryDate.getTime() > now.getTime()
      ? latestMembership.expiryDate
      : now;

  const periodEnd = addOneMonth(periodStart);

  const membershipCharge = await prisma.membershipCharge.create({
    data: {
      userId: user.id,
      paymentMethodId: paymentMethod.id,
      amountCents,
      currency: "USD",
      status: MembershipChargeStatus.PENDING,
      provider: "STRIPE",
    },
    select: {
      id: true,
    },
  });

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: user.stripeCustomerId,
      payment_method: stripePaymentMethodId,
      confirm: true,
      off_session: true,
      metadata: {
        userId: user.id,
        membershipChargeId: membershipCharge.id,
        membershipType,
        reason: args.reason,
      },
    });

    if (paymentIntent.status !== "succeeded") {
      await prisma.membershipCharge.update({
        where: { id: membershipCharge.id },
        data: {
          status: MembershipChargeStatus.FAILED,
          stripePaymentIntentId: paymentIntent.id,
          providerRef: paymentIntent.id,
          failedAt: new Date(),
        },
      });

      return {
        ok: false,
        charged: false,
        skipped: false,
        reason: "PAYMENT_FAILED",
        error: `Stripe payment did not succeed. Status: ${paymentIntent.status}`,
        membershipChargeId: membershipCharge.id,
      };
    }

    const membership = await prisma.membership.create({
      data: {
        userId: user.id,
        type: membershipType,
        startDate: periodStart,
        expiryDate: periodEnd,
        status: MembershipStatus.ACTIVE,
        amountPaidCents: amountCents,
        paymentProvider: "STRIPE",
        paymentRef: paymentIntent.id,
        plan: MembershipPlan.STANDARD,
      },
      select: {
        id: true,
      },
    });

    await prisma.membershipCharge.update({
      where: { id: membershipCharge.id },
      data: {
        membershipId: membership.id,
        status: MembershipChargeStatus.SUCCEEDED,
        stripePaymentIntentId: paymentIntent.id,
        stripeChargeId:
          typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : null,
        providerRef: paymentIntent.id,
        paidAt: new Date(),
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        membershipActive: true,
        membershipPlan: MembershipPlan.STANDARD,
      },
    });

    return {
      ok: true,
      charged: true,
      skipped: false,
      membershipId: membership.id,
      membershipChargeId: membershipCharge.id,
      stripePaymentIntentId: paymentIntent.id,
      amountCents,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe payment failed.";

    await prisma.membershipCharge.update({
      where: { id: membershipCharge.id },
      data: {
        status: MembershipChargeStatus.FAILED,
        failedAt: new Date(),
      },
    });

    return {
      ok: false,
      charged: false,
      skipped: false,
      reason: "PAYMENT_FAILED",
      error: message,
      membershipChargeId: membershipCharge.id,
    };
  }
}