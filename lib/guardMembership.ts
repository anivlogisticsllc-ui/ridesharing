// lib/guardMembership.ts
import { prisma } from "@/lib/prisma";
import {
  MembershipPlan,
  MembershipStatus,
  MembershipType,
  UserRole,
} from "@prisma/client";

export type MembershipGateState = "NONE" | "TRIAL" | "ACTIVE_PAID" | "EXPIRED";

export type GuardMembershipResult =
  | {
      ok: true;
      state: MembershipGateState;
      membership: NormalizedMembership;
    }
  | {
      ok: false;
      state: MembershipGateState;
      error: string;
      membership: NormalizedMembership;
    };

type NormalizedMembership = {
  id: string | null;
  type: MembershipType;
  plan: MembershipPlan | null;
  status: MembershipStatus | null;
  amountPaidCents: number | null;

  startDate: string | null; // ISO
  expiryDate: string | null; // ISO (source of truth)
  trialEndsAt: string | null; // ISO (for UI convenience)
  currentPeriodEnd: string | null; // ISO (same as expiryDate for MVP)

  active: boolean;
  isTrial: boolean;
  isPaid: boolean;
};

function roleToMembershipType(role: UserRole): MembershipType {
  return role === UserRole.DRIVER ? MembershipType.DRIVER : MembershipType.RIDER;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export async function guardMembership(args: {
  userId: string;
  role: UserRole;
  allowTrial: boolean;
}): Promise<GuardMembershipResult> {
  const expectedType = roleToMembershipType(args.role);
  const now = Date.now();

  const latest = await prisma.membership.findFirst({
    where: { userId: args.userId, type: expectedType },
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

  const base: NormalizedMembership = {
    id: latest?.id ?? null,
    type: expectedType,
    plan: latest?.plan ?? null,
    status: latest?.status ?? null,
    amountPaidCents: latest?.amountPaidCents ?? null,

    startDate: iso(latest?.startDate),
    expiryDate: iso(latest?.expiryDate),
    trialEndsAt: null,
    currentPeriodEnd: iso(latest?.expiryDate),

    active: false,
    isTrial: false,
    isPaid: false,
  };

  if (!latest) {
    return {
      ok: false,
      state: "NONE",
      error: "No membership found.",
      membership: base,
    };
  }

  // Safety: if schema ever allows null expiryDate, fail closed.
  if (!latest.expiryDate) {
    return {
      ok: false,
      state: "EXPIRED",
      error: "Membership has no expiry date (invalid).",
      membership: { ...base, status: MembershipStatus.EXPIRED },
    };
  }

  const expiryMs = latest.expiryDate.getTime();
  const isExpired = expiryMs <= now;

  if (isExpired) {
    return {
      ok: false,
      state: "EXPIRED",
      error: "Membership is expired.",
      membership: {
        ...base,
        status: MembershipStatus.EXPIRED,
        active: false,
        isTrial: false,
        isPaid: false,
        trialEndsAt: null,
      },
    };
  }

  const paid = (latest.amountPaidCents ?? 0) > 0;

  if (paid) {
    return {
      ok: true,
      state: "ACTIVE_PAID",
      membership: {
        ...base,
        status: MembershipStatus.ACTIVE,
        active: true,
        isTrial: false,
        isPaid: true,
        trialEndsAt: null,
      },
    };
  }

  // Trial path (MVP definition: active period, amountPaidCents === 0)
  const trialMembership: NormalizedMembership = {
    ...base,
    status: MembershipStatus.ACTIVE,
    active: true,
    isTrial: true,
    isPaid: false,
    trialEndsAt: iso(latest.expiryDate),
  };

  if (args.allowTrial) {
    return { ok: true, state: "TRIAL", membership: trialMembership };
  }

  return {
    ok: false,
    state: "TRIAL",
    error: "Trial is not sufficient. Paid membership required.",
    membership: trialMembership,
  };
}

// Back-compat helpers for older API routes
export async function requireTrialOrActive(args: {
  userId: string;
  role: UserRole;
}): Promise<GuardMembershipResult> {
  return guardMembership({
    userId: args.userId,
    role: args.role,
    allowTrial: true,
  });
}

export function membershipErrorMessage(result: GuardMembershipResult): string {
  return result.ok ? "" : result.error || "Membership required.";
}
