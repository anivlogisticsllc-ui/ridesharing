// pages/api/rides.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { prisma } from "../../lib/prisma";
import { UserRole, RideStatus } from "@prisma/client";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "GET") {
    const session = await getServerSession(req, res, authOptions);
    const mine = req.query.mine === "1";

    // GET /api/rides?mine=1 → my ride requests (as rider)
    if (mine) {
      if (!session) {
        return res
          .status(401)
          .json({ ok: false, error: "Not authenticated" });
      }

      const userId = (session.user as any).id;

      const rides = await prisma.ride.findMany({
        where: { riderId: userId },
        orderBy: { departureTime: "asc" },
      });

      return res.status(200).json({ ok: true, rides });
    }

    // GET /api/rides → open ride requests (no driver yet)
    const rides = await prisma.ride.findMany({
      where: {
        status: RideStatus.OPEN,
        driverId: null,
      },
      orderBy: { departureTime: "asc" },
    });

    return res.status(200).json({ ok: true, rides });
  }

  if (req.method === "POST") {
    // Rider posts a ride request
    const session = await getServerSession(req, res, authOptions);

    if (!session) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const role = (session.user as any).role as UserRole;
    if (role !== "RIDER" && role !== "BOTH") {
      return res.status(403).json({ ok: false, error: "Not a rider" });
    }

    const riderId = (session.user as any).id;

    const {
      originCity,
      originLat,
      originLng,
      destinationCity,
      destinationLat,
      destinationLng,
      departureTime,
      passengerCount,
      distanceMiles,
    } = req.body;

    if (
      !originCity ||
      !destinationCity ||
      !departureTime ||
      typeof distanceMiles !== "number"
    ) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    // Pricing: flat fee + per-mile. Adjust if you change your model.
    const totalPriceCents = Math.round((3 + 2 * distanceMiles) * 100);

    const ride = await prisma.ride.create({
      data: {
        riderId,
        originCity,
        originLat,
        originLng,
        destinationCity,
        destinationLat,
        destinationLng,
        departureTime: new Date(departureTime),
        passengerCount: passengerCount ?? 1,
        distanceMiles,
        totalPriceCents,
        status: RideStatus.OPEN,
      },
    });

    return res.status(201).json({ ok: true, ride });
  }

  return res.status(405).json({ ok: false, error: "Method not allowed" });
}
