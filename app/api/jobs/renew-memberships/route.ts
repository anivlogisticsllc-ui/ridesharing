// app/api/jobs/renew-memberships/route.ts

import { NextRequest, NextResponse } from "next/server";
import { MembershipStatus, UserRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { renewMembershipForUser } from "@/lib/payments/renewMembershipForUser";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return runRenewalJob(req);
}

export async function POST(req: NextRequest) {
  return runRenewalJob(req);
}

async function runRenewalJob(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "Missing CRON_SECRET" },
      { status: 500 }
    );
  }

  const auth = req.headers.get("authorization");

  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") || 25), 1),
    100
  );

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
    orderBy: [{ expiryDate: "asc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      userId: true,
      type: true,
      expiryDate: true,
      user: {
        select: {
          id: true,
          email: true,
          role: true,
        },
      },
    },
  });

  const seen = new Set<string>();

  const renewalTargets = expiredMemberships.filter((membership) => {
    const key = `${membership.userId}:${membership.type}`;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });

  const results = [];

  for (const membership of renewalTargets) {
    try {
      const result = await renewMembershipForUser({
        userId: membership.userId,
        reason: "AUTO_RENEWAL",
      });

      results.push({
        expiredMembershipId: membership.id,
        userId: membership.userId,
        userEmail: membership.user.email,
        userRole: membership.user.role,
        membershipType: membership.type,
        expiredAt: membership.expiryDate.toISOString(),
        ...result,
      });
    } catch (err) {
      results.push({
        ok: false,
        charged: false,
        skipped: false,
        expiredMembershipId: membership.id,
        userId: membership.userId,
        userEmail: membership.user.email,
        userRole: membership.user.role,
        membershipType: membership.type,
        expiredAt: membership.expiryDate.toISOString(),
        reason: "UNHANDLED_RENEWAL_ERROR",
        error: err instanceof Error ? err.message : "Unknown renewal error",
      });
    }
  }

  const charged = results.filter((r: any) => r.charged === true).length;
  const failed = results.filter((r: any) => r.ok === false).length;
  const skipped = results.filter((r: any) => r.skipped === true).length;

  return NextResponse.json({
    ok: true,
    checked: renewalTargets.length,
    charged,
    failed,
    skipped,
    results,
  });
}