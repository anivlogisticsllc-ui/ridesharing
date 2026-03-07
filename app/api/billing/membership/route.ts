// app/api/billing/membership/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import {
  MembershipPlan,
  MembershipStatus,
  MembershipType,
  UserRole,
} from "@prisma/client";

const PRICING_FALLBACK = {
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
  plan: string | null;
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
    role: UserRole;
    onboardingCompleted: boolean;
    emailVerified: boolean;
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

function toIso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

async function ensureTrialMembership(params: {
  userId: string;
  role: UserRole;
  emailVerified: boolean;
  onboardingCompleted: boolean;
}) {
  const { userId, role, emailVerified } = params;

  const type = roleToMembershipType(role);
  if (!type) return null;

  if (!emailVerified) return null;

  const existing = await prisma.membership.findFirst({
    where: { userId, type },
    orderBy: { startDate: "desc" },
    select: { id: true },
  });

  if (existing) return null;

  const startDate = new Date();
  const expiryDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);

  await prisma.membership.create({
    data: {
      userId,
      type,
      startDate,
      expiryDate,
      status: MembershipStatus.ACTIVE,
      amountPaidCents: 0,
      plan: MembershipPlan.STANDARD,
    },
  });

  return true;
}

function buildMembershipSummary(latest: {
  plan: MembershipPlan | null;
  amountPaidCents: number;
  expiryDate: Date;
  status: MembershipStatus;
} | null): MeMembership {
  if (!latest) {
    return {
      plan: null,
      active: false,
      status: null,
      trialEndsAt: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
  }

  const nowMs = Date.now();
  const isActiveByDate = latest.expiryDate.getTime() > nowMs;
  const active = isActiveByDate && latest.status === MembershipStatus.ACTIVE;
  const isTrial = active && (latest.amountPaidCents ?? 0) === 0;

  return {
    plan: latest.plan ?? null,
    active,
    status: active ? "ACTIVE" : "EXPIRED",
    trialEndsAt: isTrial ? toIso(latest.expiryDate) : null,
    currentPeriodEnd: toIso(latest.expiryDate),
    cancelAtPeriodEnd: false,
  };
}

async function priceForRole(role: UserRole): Promise<number> {
  const membershipType = roleToMembershipType(role);
  if (!membershipType) return 0;

  const pricing = await prisma.membershipPricing.findUnique({
    where: { membershipType },
    select: {
      amountCents: true,
      currency: true,
      isActive: true,
    },
  });

  if (pricing?.isActive && typeof pricing.amountCents === "number" && pricing.amountCents > 0) {
    return pricing.amountCents;
  }

  return role === UserRole.DRIVER
    ? PRICING_FALLBACK.DRIVER_MONTHLY_CENTS
    : PRICING_FALLBACK.RIDER_MONTHLY_CENTS;
}

async function getDefaultPaymentMethod(userId: string): Promise<BillingInfo["defaultPaymentMethod"]> {
  const row = await prisma.paymentMethod.findFirst({
    where: { userId, isDefault: true },
    orderBy: { updatedAt: "desc" },
    select: {
      brand: true,
      last4: true,
      expMonth: true,
      expYear: true,
    },
  });

  if (!row) return null;

  return {
    brand: row.brand ?? "",
    last4: row.last4 ?? "",
    expMonth: row.expMonth ?? 0,
    expYear: row.expYear ?? 0,
  };
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
        emailVerified: true,
      },
    });

    if (!user) {
      return NextResponse.json<ApiErr>(
        { ok: false, error: "User not found" },
        { status: 404 }
      );
    }

    await ensureTrialMembership({
      userId: user.id,
      role: user.role,
      emailVerified: user.emailVerified,
      onboardingCompleted: user.onboardingCompleted,
    });

    const expectedType = roleToMembershipType(user.role);

    const latest = expectedType
      ? await prisma.membership.findFirst({
          where: { userId: user.id, type: expectedType },
          orderBy: { startDate: "desc" },
          select: {
            plan: true,
            expiryDate: true,
            amountPaidCents: true,
            status: true,
          },
        })
      : null;

    const defaultPaymentMethod = await getDefaultPaymentMethod(user.id);
    const priceCentsPerMonth = await priceForRole(user.role);

    const billing: BillingInfo = {
      currency: "USD",
      priceCentsPerMonth,
      hasPaymentMethod: Boolean(defaultPaymentMethod),
      defaultPaymentMethod,
    };

    const payload: ApiOk = {
      ok: true,
      user: {
        id: user.id,
        name: user.name ?? null,
        email: user.email,
        role: user.role,
        onboardingCompleted: Boolean(user.onboardingCompleted),
        emailVerified: Boolean(user.emailVerified),
      },
      membership: buildMembershipSummary(latest),
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