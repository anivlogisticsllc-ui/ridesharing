// pages/api/driver/dashboard-stats.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";

type DashboardRide = {
  id: string;
  departureTime: string;    // keep for display if you want
  departureTimeMs: number;  // ✅ add this (source of truth)
  status: string;
  totalPriceCents: number;
  distanceMiles: number;
  originCity: string;
  destinationCity: string;
};

type DashboardStatsResponse =
  | { ok: true; rides: DashboardRide[] }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DashboardStatsResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);

  const user = session?.user as
    | ({
        id?: string;
        role?: "RIDER" | "DRIVER" | "ADMIN";
      } & Record<string, any>)
    | undefined;

  if (!user?.id) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  // If you want ADMIN to be able to view driver dashboard stats for themselves, allow it.
  // If you want ADMIN to view other drivers, we’ll add query params later.
  if (user.role !== "DRIVER" && user.role !== "ADMIN") {
    return res.status(403).json({ ok: false, error: "Only drivers can access dashboard stats" });
  }

  const driverId = user.id;

  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);

  try {
    const rides = await prisma.ride.findMany({
      where: {
        driverId,
        status: "COMPLETED",
        departureTime: { gte: since },
      },
      orderBy: { departureTime: "desc" },
      select: {
        id: true,
        departureTime: true,
        status: true,
        totalPriceCents: true,
        distanceMiles: true,
        originCity: true,
        destinationCity: true,
      },
    });

    const mapped: DashboardRide[] = rides.map((r) => ({
      id: r.id,
      departureTime: r.departureTime.toISOString(),
      departureTimeMs: r.departureTime.getTime(), // ✅
      status: r.status,
      totalPriceCents: r.totalPriceCents ?? 0,
      distanceMiles: r.distanceMiles ?? 0,
      originCity: r.originCity,
      destinationCity: r.destinationCity,
    }));

    return res.status(200).json({ ok: true, rides: mapped });
  } catch (err) {
    console.error("Error loading dashboard stats", err);
    return res.status(500).json({ ok: false, error: "Failed to load dashboard stats" });
  }
}
