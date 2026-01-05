// app/api/admin/riders/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const isAdmin = Boolean((session?.user as any)?.isAdmin);

  if (!userId) return { ok: false as const, status: 401, error: "Not authenticated" };
  if (!isAdmin) return { ok: false as const, status: 403, error: "Forbidden" };

  return { ok: true as const, userId };
}

export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();

    const where: any = { role: "RIDER" };

    if (q) {
      where.OR = [
        { email: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        // only include publicId if it exists in your schema
        { publicId: { contains: q, mode: "insensitive" } },
      ];
    }

    const riders = await prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isAdmin: true,
        accountStatus: true,
        createdAt: true,
        updatedAt: true,
        publicId: true,
        onboardingCompleted: true,
        membershipActive: true,
        membershipPlan: true,
        trialEndsAt: true,
      },
    });

    return NextResponse.json({ ok: true, riders });
  } catch (e: any) {
    console.error("admin/riders GET failed:", e);
    return NextResponse.json(
      { ok: false, error: "Failed to load riders", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
