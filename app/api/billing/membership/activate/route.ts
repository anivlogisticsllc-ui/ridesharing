// app/api/billing/membership/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { MembershipStatus, MembershipType, UserRole } from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function roleToMembershipType(role: UserRole): MembershipType | null {
  if (role === UserRole.DRIVER) return MembershipType.DRIVER;
  if (role === UserRole.RIDER) return MembershipType.RIDER;
  return null;
}

function priceForRole(role: UserRole): number {
  return role === UserRole.DRIVER ? PRICING.DRIVER_MONTHLY_CENTS : PRICING.RIDER_MONTHLY_CENTS;
}

function computeStatus(expiryDate: Date | null, now: Date): MembershipStatus {
  if (!expiryDate) return MembershipStatus.EXPIRED;
  return expiryDate.getTime() > now.getTime() ? MembershipStatus.ACTIVE : MembershipStatus.EXPIRED;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json<ApiErr>({ ok: false, error: "Not authenticated" }, { status: 401 });
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
      return NextResponse.json<ApiErr>({ ok: false, error: "User not found" }, { status: 404 });
    }

    const membershipType = roleToMembershipType(user.role);
    const now = new Date();

    // default card from DB (no Stripe call)
    const defaultPm = await prisma.paymentMethod.findFirst({
      where: { userId: user.id, isDefault: true },
      orderBy: { updatedAt: "desc" },
      select: { brand: true, last4: true, expMonth: true, expYear: true, stripePaymentMethodId: true },
    });

    const billing: BillingInfo = {
      currency: "USD",
      priceCentsPerMonth: priceForRole(user.role),
      hasPaymentMethod: Boolean(defaultPm?.stripePaymentMethodId),
      defaultPaymentMethod: defaultPm?.stripePaymentMethodId
        ? {
            brand: defaultPm.brand || "Card",
            last4: defaultPm.last4 || "",
            expMonth: defaultPm.expMonth || 0,
            expYear: defaultPm.expYear || 0,
          }
        : null,
    };

    // If ADMIN (or unexpected role), return no membership but still show billing info
    if (!membershipType) {
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

    const latest = await prisma.membership.findFirst({
      where: { userId: user.id, type: membershipType },
      orderBy: { startDate: "desc" },
      select: {
        plan: true,
        expiryDate: true,
        amountPaidCents: true,
      },
    });

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

    const computed = computeStatus(latest.expiryDate ?? null, now);
    const active = computed === MembershipStatus.ACTIVE;

    // Your MVP rule: trial = active + amountPaidCents === 0
    const isTrial = active && (latest.amountPaidCents ?? 0) === 0;

    const periodEndIso = latest.expiryDate ? latest.expiryDate.toISOString() : null;

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
        status: active ? "ACTIVE" : "EXPIRED",
        trialEndsAt: isTrial ? periodEndIso : null,
        currentPeriodEnd: periodEndIso,
        cancelAtPeriodEnd: false,
      },
      billing,
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error("GET /api/billing/membership error:", err);
    return NextResponse.json<ApiErr>({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}