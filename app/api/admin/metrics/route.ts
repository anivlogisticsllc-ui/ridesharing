// app/api/admin/metrics/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function startOfTodayLocal() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);

  const userId = (session?.user as any)?.id as string | undefined;
  const role = (session?.user as any)?.role as "RIDER" | "DRIVER" | "ADMIN" | undefined;

  if (!userId) return { ok: false as const, status: 401, error: "Not authenticated" };
  if (role !== "ADMIN") return { ok: false as const, status: 403, error: "Forbidden" };

  return { ok: true as const, userId };
}

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const todayStart = startOfTodayLocal();

  const [
    openRides,
    acceptedRides,
    inRouteRides,
    completedToday,
    cancelledToday,
    usersTotal,
    driversTotal,
  ] = await Promise.all([
    prisma.ride.count({ where: { status: "OPEN" } }),
    prisma.ride.count({ where: { status: "ACCEPTED" } }),
    prisma.ride.count({ where: { status: "IN_ROUTE" } }),
    prisma.ride.count({ where: { status: "COMPLETED", updatedAt: { gte: todayStart } } }),
    prisma.ride.count({ where: { status: "CANCELLED", updatedAt: { gte: todayStart } } }),
    prisma.user.count(),
    prisma.user.count({ where: { role: "DRIVER" } }),
  ]);

  return NextResponse.json({
    ok: true,
    metrics: {
      openRides,
      acceptedRides,
      inRouteRides,
      completedToday,
      cancelledToday,
      usersTotal,
      driversTotal,
    },
  });
}
