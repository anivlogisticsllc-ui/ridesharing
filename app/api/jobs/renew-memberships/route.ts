// app/api/jobs/renew-memberships/route.ts

import { NextRequest, NextResponse } from "next/server";
import {
  MembershipPlan,
  MembershipStatus,
  MembershipType,
  MembershipChargeStatus,
  UserRole,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

const FALLBACK_PRICE_CENTS = {
  RIDER: 299,
  DRIVER: 999,
} as const;

function addOneMonth(date: Date) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  return d;
}

function membershipTypeForRole(role: UserRole): MembershipType | null {
  if (role === UserRole.RIDER) return MembershipType.RIDER;
  if (role === UserRole.DRIVER) return MembershipType.DRIVER;
  return null;
}

async function priceForType(type: MembershipType) {
  const pricing = await prisma.membershipPricing.findUnique({
    where: { membershipType: type },
    select: {
      amountCents: true,
      currency: true,
      isActive: true,
    },
  });

  if (pricing?.isActive && pricing.amountCents > 0) {
    return {
      amountCents: pricing.amountCents,
      currency: pricing.currency || "USD",
    };
  }

  return {
    amountCents:
      type === MembershipType.DRIVER
        ? FALLBACK_PRICE_CENTS.DRIVER
        : FALLBACK_PRICE_CENTS.RIDER,
    currency: "USD",
  };
}

async function renewOneMembership(membershipId: string) {
  const now = new Date();

  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
    include: {
      user: {
        include: {
          paymentMethods: {
            where: { isDefault: true },
            orderBy: { updatedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!membership) {
    return { ok: false, membershipId, skipped: true, reason: "MEMBERSHIP_NOT_FOUND" };
  }

  if (membership.status !== MembershipStatus.ACTIVE) {
    return { ok: true, membershipId, skipped: true, reason: "NOT_ACTIVE_STATUS" };
  }

  if (membership.expiryDate > now) {
    return {
      ok: true,
      membershipId,
      skipped: true,
      reason: "MEMBERSHIP_NOT_EXPIRED_YET",
      activeUntil: membership.expiryDate.toISOString(),
    };
  }

  const type = membershipTypeForRole(membership.user.role);
  if (!type) {
    return { ok: true, membershipId, skipped: true, reason: "ROLE_NOT_RENEWABLE" };
  }

  if (membership.user.freeMembershipEndsAt && membership.user.freeMembershipEndsAt > now) {
    return {
      ok: true,
      membershipId,
      skipped: true,
      reason: "ADMIN_GRANT_ACTIVE",
      activeUntil: membership.user.freeMembershipEndsAt.toISOString(),
    };
  }

  const paymentMethod = membership.user.paymentMethods[0] ?? null;
  const stripePaymentMethodId =
    paymentMethod?.stripePaymentMethodId || paymentMethod?.providerPaymentMethodId || null;

  if (!membership.user.stripeCustomerId || !stripePaymentMethodId) {
    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: MembershipStatus.EXPIRED },
    });

    await prisma.user.update({
      where: { id: membership.userId },
      data: { membershipActive: false },
    });

    return {
      ok: false,
      membershipId,
      skipped: true,
      reason: "NO_DEFAULT_PAYMENT_METHOD",
    };
  }

  const price = await priceForType(type);

  const charge = await prisma.membershipCharge.create({
    data: {
      userId: membership.userId,
      membershipId: membership.id,
      paymentMethodId: paymentMethod?.id ?? null,
      amountCents: price.amountCents,
      currency: price.currency.toUpperCase(),
      status: MembershipChargeStatus.PENDING,
      provider: "STRIPE",
    },
  });

  try {
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: price.amountCents,
        currency: price.currency.toLowerCase(),
        customer: membership.user.stripeCustomerId,
        payment_method: stripePaymentMethodId,
        confirm: true,
        off_session: true,
        description: `${type} membership renewal`,
        metadata: {
          userId: membership.userId,
          membershipId: membership.id,
          membershipChargeId: charge.id,
          type,
        },
      },
      {
        idempotencyKey: `membership-renewal:${membership.userId}:${membership.id}:${membership.expiryDate.toISOString()}`,
      }
    );

    const nextStart = now;
    const nextExpiry = addOneMonth(now);

    const renewed = await prisma.membership.create({
      data: {
        userId: membership.userId,
        type,
        startDate: nextStart,
        expiryDate: nextExpiry,
        status: MembershipStatus.ACTIVE,
        amountPaidCents: price.amountCents,
        paymentProvider: "STRIPE",
        paymentRef: paymentIntent.id,
        plan: membership.plan || MembershipPlan.STANDARD,
      },
    });

    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: MembershipStatus.EXPIRED },
    });

    await prisma.membershipCharge.update({
      where: { id: charge.id },
      data: {
        membershipId: renewed.id,
        status: MembershipChargeStatus.SUCCEEDED,
        stripePaymentIntentId: paymentIntent.id,
        providerRef: paymentIntent.id,
        paidAt: new Date(),
      },
    });

    await prisma.user.update({
      where: { id: membership.userId },
      data: {
        membershipActive: true,
        membershipPlan: String(renewed.plan),
      },
    });

    return {
      ok: true,
      charged: true,
      skipped: false,
      userId: membership.userId,
      oldMembershipId: membership.id,
      newMembershipId: renewed.id,
      amountCents: price.amountCents,
      activeUntil: nextExpiry.toISOString(),
      paymentIntentId: paymentIntent.id,
    };
  } catch (err: any) {
    await prisma.membershipCharge.update({
      where: { id: charge.id },
      data: {
        status: MembershipChargeStatus.FAILED,
        failedAt: new Date(),
      },
    });

    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: MembershipStatus.EXPIRED },
    });

    await prisma.user.update({
      where: { id: membership.userId },
      data: { membershipActive: false },
    });

    return {
      ok: false,
      charged: false,
      skipped: false,
      userId: membership.userId,
      membershipId: membership.id,
      reason: "STRIPE_CHARGE_FAILED",
      error: err?.message || "Stripe charge failed",
    };
  }
}

export async function GET(req: NextRequest) {
  return runRenewalJob(req);
}

export async function POST(req: NextRequest) {
  return runRenewalJob(req);
}

async function runRenewalJob(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 25), 1), 100);

  const now = new Date();

  const expiredMemberships = await prisma.membership.findMany({
    where: {
      status: MembershipStatus.ACTIVE,
      expiryDate: { lte: now },
      user: {
        accountStatus: "ACTIVE",
        role: { in: [UserRole.RIDER, UserRole.DRIVER] },
      },
    },
    orderBy: { expiryDate: "asc" },
    take: limit,
    select: { id: true },
  });

  const results = [];

  for (const item of expiredMemberships) {
    const result = await renewOneMembership(item.id);
    results.push(result);
  }

  return NextResponse.json({
    ok: true,
    checked: expiredMemberships.length,
    charged: results.filter((r: any) => r.charged).length,
    failed: results.filter((r: any) => r.ok === false).length,
    skipped: results.filter((r: any) => r.skipped).length,
    results,
  });
}