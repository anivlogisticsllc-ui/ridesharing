// app/api/billing/membership/route.ts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
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

type FailedRenewalInfo = {
  amountCents: number;
  failedAt: string | null;
  reason: string | null;
  stripePaymentIntentId: string | null;
};

type BillingInfo = {
  currency: "USD";
  priceCentsPerMonth: number;
  hasPaymentMethod: boolean;
  defaultPaymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
  failedRenewal: FailedRenewalInfo | null;
};

type MeMembership = {
  plan: string | null;
  kind: "TRIAL" | "PAID" | "ADMIN_GRANT" | "NONE";
  source: "membership" | "freeMembershipEndsAt" | "none";
  active: boolean;
  status: "ACTIVE" | "EXPIRED" | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

type ApiOk = {
  ok: true;
  user: {
    id: string;
    name: string | null;
    email: string;
    role: "RIDER" | "DRIVER";
    onboardingCompleted: boolean;
  };
  membership: MeMembership;
  billing: BillingInfo;
};

type ApiError = { ok: false; error: string };

export const dynamic = "force-dynamic";
export const revalidate = 0;

function toIso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

function membershipTypeForRole(role: UserRole): MembershipType | null {
  if (role === UserRole.RIDER) return MembershipType.RIDER;
  if (role === UserRole.DRIVER) return MembershipType.DRIVER;
  return null;
}

async function getPriceCents(type: MembershipType) {
  const pricing = await prisma.membershipPricing.findUnique({
    where: { membershipType: type },
    select: {
      amountCents: true,
      isActive: true,
    },
  });

  if (pricing?.isActive && pricing.amountCents > 0) {
    return pricing.amountCents;
  }

  return type === MembershipType.DRIVER
    ? PRICING_FALLBACK.DRIVER_MONTHLY_CENTS
    : PRICING_FALLBACK.RIDER_MONTHLY_CENTS;
}

function buildMembershipSummary(args: {
  latest: {
    plan: MembershipPlan | null;
    amountPaidCents: number;
    expiryDate: Date;
    status: MembershipStatus;
  } | null;
  freeMembershipEndsAt?: Date | null;
}): MeMembership {
  const nowMs = Date.now();

  const grantEndsAt = args.freeMembershipEndsAt ?? null;
  const grantMs = grantEndsAt?.getTime() ?? 0;

  if (grantMs > nowMs) {
    return {
      plan: MembershipPlan.STANDARD,
      kind: "ADMIN_GRANT",
      source: "freeMembershipEndsAt",
      active: true,
      status: "ACTIVE",
      trialEndsAt: null,
      currentPeriodEnd: toIso(grantEndsAt),
      cancelAtPeriodEnd: false,
    };
  }

  const latest = args.latest;

  if (!latest) {
    return {
      plan: null,
      kind: "NONE",
      source: "none",
      active: false,
      status: null,
      trialEndsAt: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
  }

  const isActiveByDate = latest.expiryDate.getTime() > nowMs;
  const active = isActiveByDate && latest.status === MembershipStatus.ACTIVE;
  const isTrial = active && (latest.amountPaidCents ?? 0) === 0;

  return {
    plan: latest.plan ?? null,
    kind: isTrial ? "TRIAL" : active ? "PAID" : "NONE",
    source: "membership",
    active,
    status: active ? "ACTIVE" : "EXPIRED",
    trialEndsAt: isTrial ? toIso(latest.expiryDate) : null,
    currentPeriodEnd: toIso(latest.expiryDate),
    cancelAtPeriodEnd: false,
  };
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const sessionUser = session?.user as any;

    if (!sessionUser?.id) {
      return NextResponse.json<ApiError>(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        onboardingCompleted: true,
        freeMembershipEndsAt: true,
      },
    });

    if (!user) {
      return NextResponse.json<ApiError>(
        { ok: false, error: "User not found" },
        { status: 404 }
      );
    }

    if (user.role !== UserRole.RIDER && user.role !== UserRole.DRIVER) {
      return NextResponse.json<ApiError>(
        { ok: false, error: "Membership is only available for riders and drivers." },
        { status: 400 }
      );
    }

    const membershipType = membershipTypeForRole(user.role);

    if (!membershipType) {
      return NextResponse.json<ApiError>(
        { ok: false, error: "Unsupported membership type." },
        { status: 400 }
      );
    }

    const [latest, priceCentsPerMonth, defaultPaymentMethod, failedRenewalCharge] =
      await Promise.all([
        prisma.membership.findFirst({
          where: {
            userId: user.id,
            type: membershipType,
          },
          orderBy: [{ expiryDate: "desc" }, { createdAt: "desc" }],
          select: {
            plan: true,
            amountPaidCents: true,
            expiryDate: true,
            status: true,
          },
        }),

        getPriceCents(membershipType),

        prisma.paymentMethod.findFirst({
          where: {
            userId: user.id,
            isDefault: true,
            provider: "STRIPE",
          },
          orderBy: { updatedAt: "desc" },
          select: {
            brand: true,
            last4: true,
            expMonth: true,
            expYear: true,
          },
        }),

        prisma.membershipCharge.findFirst({
          where: {
            userId: user.id,
            status: MembershipChargeStatus.FAILED,
          },
          orderBy: [{ failedAt: "desc" }, { createdAt: "desc" }],
          select: {
            amountCents: true,
            failedAt: true,
            stripePaymentIntentId: true,
            providerRef: true,
          },
        }),
      ]);

    const membership = buildMembershipSummary({
      latest,
      freeMembershipEndsAt: user.freeMembershipEndsAt ?? null,
    });

    const billing: BillingInfo = {
      currency: "USD",
      priceCentsPerMonth,
      hasPaymentMethod: Boolean(defaultPaymentMethod),
      defaultPaymentMethod: defaultPaymentMethod
        ? {
            brand: defaultPaymentMethod.brand || "Card",
            last4: defaultPaymentMethod.last4 || "",
            expMonth: defaultPaymentMethod.expMonth || 0,
            expYear: defaultPaymentMethod.expYear || 0,
          }
        : null,
      failedRenewal: failedRenewalCharge
        ? {
            amountCents: failedRenewalCharge.amountCents,
            failedAt: toIso(failedRenewalCharge.failedAt),
            reason: "Payment failed",
            stripePaymentIntentId:
              failedRenewalCharge.stripePaymentIntentId ??
              failedRenewalCharge.providerRef ??
              null,
          }
        : null,
    };

    const payload: ApiOk = {
      ok: true,
      user: {
        id: user.id,
        name: user.name ?? null,
        email: user.email,
        role: user.role,
        onboardingCompleted: Boolean(user.onboardingCompleted),
      },
      membership,
      billing,
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error("GET /api/billing/membership error:", err);
    return NextResponse.json<ApiError>(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}