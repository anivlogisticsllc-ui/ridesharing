// pages/api/auth/me.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./[...nextauth]";
import { prisma } from "../../../lib/prisma";
import {
  MembershipPlan,
  MembershipStatus,
  MembershipType,
  UserRole,
} from "@prisma/client";

type MembershipSummary = {
  plan: string | null;
  kind: "NONE" | "TRIAL" | "PAID";
  status: "none" | "trialing" | "active" | "expired";
  active: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

type MeOkResponse = {
  ok: true;
  user: {
    id: string;
    name: string | null;
    email: string;
    role: "RIDER" | "DRIVER" | "ADMIN";
    onboardingCompleted: boolean;
    emailVerified: boolean;
  };
  membership: MembershipSummary;
};

type MeErrResponse = { ok: false; error: string };

function toIso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

function roleToMembershipType(role: UserRole): MembershipType | null {
  if (role === UserRole.DRIVER) return MembershipType.DRIVER;
  if (role === UserRole.RIDER) return MembershipType.RIDER;
  return null;
}

function isTransientDbError(err: unknown) {
  const msg = String((err as any)?.message || err || "");
  return (
    msg.includes("kind: Closed") ||
    msg.includes("Error { kind: Closed") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("EPIPE") ||
    msg.includes("Connection terminated") ||
    msg.includes("server closed the connection") ||
    msg.includes("terminated unexpectedly")
  );
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (retries > 0 && isTransientDbError(err)) {
      await new Promise((r) => setTimeout(r, 150));
      return withRetry(fn, retries - 1);
    }
    throw err;
  }
}

function emptyMembership(): MembershipSummary {
  return {
    plan: null,
    kind: "NONE",
    status: "none",
    active: false,
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  };
}

/**
 * Ensures a trial membership exists for verified users (self-healing).
 * Devil’s advocate guard: only auto-create for RIDER/DRIVER, never ADMIN.
 *
 * If you want to require onboardingCompleted before trial creation,
 * add: if (!user.onboardingCompleted) return null;
 */
async function ensureTrialMembership(params: {
  userId: string;
  role: UserRole;
  emailVerified: boolean;
  onboardingCompleted: boolean;
}) {
  const { userId, role, emailVerified } = params;

  const type = roleToMembershipType(role);
  if (!type) return null;

  // Only create after email verification (matches your stated rule)
  if (!emailVerified) return null;

  // Optional stricter guard (uncomment if desired):
  // if (!params.onboardingCompleted) return null;

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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MeOkResponse | MeErrResponse>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return res.status(401).json({ ok: false, error: "Not authenticated" });

  try {
    const user = await withRetry(() =>
      prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          onboardingCompleted: true,
          emailVerified: true,
        },
      })
    );

    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    // Ensure membership exists for verified users
    await withRetry(() =>
      ensureTrialMembership({
        userId: user.id,
        role: user.role,
        emailVerified: user.emailVerified,
        onboardingCompleted: user.onboardingCompleted,
      })
    );

    const expectedType = roleToMembershipType(user.role);

    // ADMIN: user info + no membership
    if (!expectedType) {
      return res.status(200).json({
        ok: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          onboardingCompleted: user.onboardingCompleted,
          emailVerified: user.emailVerified,
        },
        membership: emptyMembership(),
      });
    }

    const latest = await withRetry(() =>
      prisma.membership.findFirst({
        where: { userId: user.id, type: expectedType },
        orderBy: { startDate: "desc" },
        select: {
          id: true,
          plan: true,
          amountPaidCents: true,
          expiryDate: true,
          status: true,
        },
      })
    );

    if (!latest) {
      return res.status(200).json({
        ok: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          onboardingCompleted: user.onboardingCompleted,
          emailVerified: user.emailVerified,
        },
        membership: emptyMembership(),
      });
    }

    const nowMs = Date.now();
    const periodEndIso = toIso(latest.expiryDate);
    const isActiveByDate = latest.expiryDate.getTime() > nowMs;
    const paid = (latest.amountPaidCents ?? 0) > 0;

    if (!isActiveByDate || latest.status !== MembershipStatus.ACTIVE) {
      return res.status(200).json({
        ok: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          onboardingCompleted: user.onboardingCompleted,
          emailVerified: user.emailVerified,
        },
        membership: {
          plan: latest.plan ?? null,
          kind: "NONE",
          status: "expired",
          active: false,
          trialEndsAt: null,
          currentPeriodEnd: periodEndIso,
          cancelAtPeriodEnd: false,
        },
      });
    }

    const kind: MembershipSummary["kind"] = paid ? "PAID" : "TRIAL";

    return res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        onboardingCompleted: user.onboardingCompleted,
        emailVerified: user.emailVerified,
      },
      membership: {
        plan: latest.plan ?? null,
        kind,
        status: paid ? "active" : "trialing",
        active: true,
        trialEndsAt: paid ? null : periodEndIso,
        currentPeriodEnd: periodEndIso,
        cancelAtPeriodEnd: false,
      },
    });
  } catch (err: any) {
    console.error("GET /api/auth/me failed:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
}