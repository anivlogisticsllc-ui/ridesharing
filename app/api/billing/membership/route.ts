// app/api/billing/membership/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { MembershipStatus, MembershipType, UserRole } from "@prisma/client";

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

type MeMembership = {
  plan: string | null; // display only
  active: boolean;
  status: "ACTIVE" | "EXPIRED" | null;
  trialEndsAt: string | null; // ISO
  currentPeriodEnd: string | null; // ISO
  cancelAtPeriodEnd: boolean;
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
  membership: MeMembership;
  billing: BillingInfo;
};

type ApiErr = { ok: false; error: string };

function roleToMembershipType(role: UserRole): MembershipType {
  return role === UserRole.DRIVER ? MembershipType.DRIVER : MembershipType.RIDER;
}

function priceForRole(role: UserRole): number {
  return role === UserRole.DRIVER
    ? PRICING.DRIVER_MONTHLY_CENTS
    : PRICING.RIDER_MONTHLY_CENTS;
}

function statusFromExpiry(expiryDate: Date, now: Date): MembershipStatus {
  return expiryDate.getTime() > now.getTime()
    ? MembershipStatus.ACTIVE
    : MembershipStatus.EXPIRED;
}

export async function GET() {
  try {
    // NOTE: This relies on NextAuth being configured to work in App Router with this call.
    // If you ever see flaky auth here, we’ll switch to NextAuth's App Router helper pattern.
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
        plan: true,
        expiryDate: true,
        amountPaidCents: true,
      },
    });

    const billing: BillingInfo = {
      currency: "USD",
      priceCentsPerMonth: priceForRole(user.role),
      hasPaymentMethod: false,
      defaultPaymentMethod: null,
    };

    // No membership row at all
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
          active: false,
          status: null,
          trialEndsAt: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        },
        billing,
      };

      return NextResponse.json(payload);
    }

    // Fail closed if legacy/bad row
    if (!latest.expiryDate) {
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
          active: false,
          status: "EXPIRED",
          trialEndsAt: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        },
        billing,
      };

      return NextResponse.json(payload);
    }

    const computed = statusFromExpiry(latest.expiryDate, now);
    const active = computed === MembershipStatus.ACTIVE;

    // MVP definition: trial = active + amountPaidCents === 0
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
        active,
        status: computed === MembershipStatus.ACTIVE ? "ACTIVE" : "EXPIRED",
        trialEndsAt: isTrial ? latest.expiryDate.toISOString() : null,
        currentPeriodEnd: latest.expiryDate.toISOString(),
        cancelAtPeriodEnd: false,
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
