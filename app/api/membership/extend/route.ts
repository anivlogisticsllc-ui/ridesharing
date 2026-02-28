// app/api/membership/extend/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { MembershipStatus, MembershipType } from "@prisma/client";

type ReqBody = {
  email: string;
  days: number;
  type: "RIDER" | "DRIVER";
};

function toMembershipType(t: ReqBody["type"]): MembershipType {
  return t === "DRIVER" ? MembershipType.DRIVER : MembershipType.RIDER;
}

function isValidEmail(email: string): boolean {
  // Simple check is OK for admin tooling
  return email.includes("@") && email.includes(".");
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const role = (session?.user as any)?.role as string | undefined;

    if (!session?.user || role !== "ADMIN") {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as ReqBody | null;

    const email = body?.email?.trim().toLowerCase() ?? "";
    const days = Number(body?.days);
    const type = body?.type;

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ ok: false, error: "Invalid email" }, { status: 400 });
    }
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      return NextResponse.json({ ok: false, error: "Invalid days" }, { status: 400 });
    }
    if (type !== "RIDER" && type !== "DRIVER") {
      return NextResponse.json({ ok: false, error: "Invalid type" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    const membershipType = toMembershipType(type);
    const now = new Date();

    // Find latest membership for that type
    const latest = await prisma.membership.findFirst({
      where: { userId: user.id, type: membershipType },
      orderBy: { startDate: "desc" },
      select: { id: true, expiryDate: true },
    });

    const baseExpiry = latest?.expiryDate && latest.expiryDate > now ? latest.expiryDate : now;
    const newExpiry = new Date(baseExpiry.getTime() + days * 24 * 60 * 60 * 1000);

    if (!latest) {
      // IMPORTANT: do NOT set plan: null unless your Prisma schema allows it.
      // If plan is optional, omit it; if required, set a real enum value (e.g. STANDARD).
      await prisma.membership.create({
        data: {
          userId: user.id,
          type: membershipType,
          status: MembershipStatus.ACTIVE,
          startDate: now,
          expiryDate: newExpiry,
          amountPaidCents: 0, // treat as trial unless you later set paid
        },
      });
    } else {
      await prisma.membership.update({
        where: { id: latest.id },
        data: {
          expiryDate: newExpiry,
          status: MembershipStatus.ACTIVE,
        },
      });
    }

    return NextResponse.json(
      {
        ok: true,
        email,
        type,
        newExpiry: newExpiry.toISOString(),
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("POST /api/membership/extend error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}