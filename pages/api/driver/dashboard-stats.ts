// pages/api/driver/dashboard-stats.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";

type DashboardRide = {
  id: string;
  departureTime: string; // ISO
  status: string;
  totalPriceCents: number;
  distanceMiles: number;
  originCity: string;
  destinationCity: string;
};

type DashboardStatsResponse =
  | {
      ok: true;
      rides: DashboardRide[];
    }
  | {
      ok: false;
      error: string;
    };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DashboardStatsResponse>
) {
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);

  const user = session?.user as
    | ({
        id?: string;
        name?: string | null;
        email?: string | null;
        image?: string | null;
      } & {
        role?: "RIDER" | "DRIVER";
      })
    | undefined;

  if (!user?.id) {
    return res
      .status(401)
      .json({ ok: false, error: "Not authenticated as driver" });
  }

  const role = user.role;

  if (role !== "DRIVER") {
    return res.status(403).json({
      ok: false,
      error: "Only drivers can access dashboard stats",
    });
  }

  const driverId = user.id;

  // Limit to last 12 months for dashboard data
  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);

  try {
    const rides = await prisma.ride.findMany({
      where: {
        driverId,
        status: "COMPLETED",
        departureTime: {
          gte: since,
        },
      },
      orderBy: {
        departureTime: "desc",
      },
    });

    const mapped: DashboardRide[] = rides.map((r) => ({
      id: r.id,
      departureTime: r.departureTime.toISOString(),
      status: r.status,
      totalPriceCents: r.totalPriceCents ?? 0,
      distanceMiles: r.distanceMiles ?? 0,
      originCity: r.originCity,
      destinationCity: r.destinationCity,
    }));

    return res.status(200).json({ ok: true, rides: mapped });
  } catch (err) {
    console.error("Error loading dashboard stats", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to load dashboard stats",
    });
  }
}
