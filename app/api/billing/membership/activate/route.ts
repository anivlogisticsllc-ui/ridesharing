import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { MembershipStatus, MembershipType, MembershipPlan, type UserRole } from "@prisma/client";

function roleToMembershipType(role: UserRole): MembershipType {
  return role === "DRIVER" ? MembershipType.DRIVER : MembershipType.RIDER;
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as
      | { plan?: MembershipPlan; days?: number }
      | null;

    const plan = body?.plan ?? MembershipPlan.STANDARD;
    const days = Number.isFinite(body?.days) ? Number(body?.days) : 30;

    // get user role (membership type depends on it)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    const type = roleToMembershipType(user.role as UserRole);

    const now = new Date();
    const expiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    // Keep it simple for now:
    // - Create a new Membership row (source of truth going forward)
    // - Also keep legacy columns in sync for old UI paths
    const result = await prisma.$transaction(async (tx) => {
      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          type,
          plan,
          startDate: now,
          expiryDate: expiry,
          status: MembershipStatus.ACTIVE,
          amountPaidCents: 0,
          paymentProvider: null,
          paymentRef: null,
        },
        select: { id: true, type: true, plan: true, startDate: true, expiryDate: true, status: true },
      });

      await tx.user.update({
        where: { id: user.id },
        data: {
          membershipActive: true,
          membershipPlan: plan,
          trialEndsAt: expiry, // treating this as “trial end” for now (until Stripe)
        },
      });

      return membership;
    });

    return NextResponse.json({ ok: true, membership: result });
  } catch (err) {
    console.error("POST /api/billing/membership/activate error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
