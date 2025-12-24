// app/api/billing/membership/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import {
  MembershipStatus,
  MembershipType,
  UserRole,
  type MembershipPlan,
} from "@prisma/client";

const PRICING = {
  RIDER_MONTHLY_CENTS: 299,
  DRIVER_MONTHLY_CENTS: 999,
} as const;

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
};

type ApiOk = {
  ok: true;
  user: {
    id: string;
    name: string | null;
    email: string;
    role: UserRole;
    onboardingCompleted: boolean;
  };
  membership: {
    plan: MembershipPlan | null;
    kind: "TRIAL" | "PAID" | "NONE";
    active: boolean;
    status: MembershipStatus | null;

    trialEndsAt: string | null;
    currentPeriodEnd: string | null;

    cancelAtPeriodEnd: boolean;

    latestMembershipId: string | null;
    latestMembershipType: MembershipType;
    latestMembershipExpiry: string | null;
  };
  billing: BillingInfo;
};

type ApiErr = { ok: false; error: string };

function roleToMembershipType(role: UserRole): MembershipType {
  return role === UserRole.DRIVER ? MembershipType.DRIVER : MembershipType.RIDER;
}

function computeStatusFromExpiry(expiryDate: Date, now: Date): MembershipStatus {
  return expiryDate.getTime() > now.getTime()
    ? MembershipStatus.ACTIVE
    : MembershipStatus.EXPIRED;
}

function priceForRole(role: UserRole): number {
  return role === UserRole.DRIVER
    ? PRICING.DRIVER_MONTHLY_CENTS
    : PRICING.RIDER_MONTHLY_CENTS;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json<ApiErr>(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        onboardingCompleted: true,
      },
    });

    if (!user) {
      return NextResponse.json<ApiErr>(
        { ok: false, error: "User not found" },
        { status: 404 }
      );
    }

    const expectedType = roleToMembershipType(user.role);
    const now = new Date();

    const latest = await prisma.membership.findFirst({
      where: { userId: user.id, type: expectedType },
      orderBy: { startDate: "desc" },
      select: {
        id: true,
        type: true,
        plan: true,
        startDate: true,
        expiryDate: true,
        amountPaidCents: true,
      },
    });

    // Stripe later: for now, always "no card"
    const billing: BillingInfo = {
      currency: "USD",
      priceCentsPerMonth: priceForRole(user.role),
      hasPaymentMethod: false,
      defaultPaymentMethod: null,
    };

    if (!latest) {
      const payload: ApiOk = {
        ok: true,
        user: {
          id: user.id,
          name: user.name ?? null,
          email: user.email,
          role: user.role,
          onboardingCompleted: Boolean(user.onboardingCompleted),
        },
        membership: {
          plan: null,
          kind: "NONE",
          active: false,
          status: null,
          trialEndsAt: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          latestMembershipId: null,
          latestMembershipType: expectedType,
          latestMembershipExpiry: null,
        },
        billing,
      };

      return NextResponse.json(payload);
    }

    const computedStatus = computeStatusFromExpiry(latest.expiryDate, now);
    const active = computedStatus === MembershipStatus.ACTIVE;
    const isTrial = active && (latest.amountPaidCents ?? 0) === 0;

    const payload: ApiOk = {
      ok: true,
      user: {
        id: user.id,
        name: user.name ?? null,
        email: user.email,
        role: user.role,
        onboardingCompleted: Boolean(user.onboardingCompleted),
      },
      membership: {
        plan: latest.plan ?? null,
        kind: isTrial ? "TRIAL" : "PAID",
        active,
        status: computedStatus,
        trialEndsAt: isTrial ? latest.expiryDate.toISOString() : null,
        currentPeriodEnd: latest.expiryDate.toISOString(),
        cancelAtPeriodEnd: false,
        latestMembershipId: latest.id,
        latestMembershipType: latest.type,
        latestMembershipExpiry: latest.expiryDate.toISOString(),
      },
      billing,
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error("GET /api/billing/membership error:", err);
    return NextResponse.json<ApiErr>(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
