// pages/api/rides.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { prisma } from "../../lib/prisma";
import { MembershipType, RideStatus } from "@prisma/client";
import { membershipErrorMessage, requireTrialOrActive } from "@/lib/guardMembership";

type ApiResponse =
  | { ok: true; rides: any[] }
  | { ok: true; ride: any }
  | { ok: false; error: string };

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  // ---------- GET ----------
  if (req.method === "GET") {
    const session = await getServerSession(req, res, authOptions);
    const mine = req.query.mine === "1";

    if (mine) {
      if (!session) {
        return res.status(401).json({ ok: false, error: "Not authenticated" });
      }

      const userId = (session.user as any).id as string;

      const rides = await prisma.ride.findMany({
        where: { riderId: userId },
        orderBy: { departureTime: "asc" },
      });

      return res.status(200).json({ ok: true, rides });
    }

    const rides = await prisma.ride.findMany({
      where: { status: RideStatus.OPEN, driverId: null },
      orderBy: { departureTime: "asc" },
    });

    return res.status(200).json({ ok: true, rides });
  }

  // ---------- POST ----------
  if (req.method === "POST") {
    const session = await getServerSession(req, res, authOptions);

    if (!session) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const role = (session.user as any)?.role as "RIDER" | "DRIVER" | undefined;
    if (role !== "RIDER") {
      return res.status(403).json({ ok: false, error: "Not a rider" });
    }

    const riderId = (session.user as any).id as string;

    // ✅ Membership gate (RIDER)
    const gate = await requireTrialOrActive({
      userId: riderId,
      type: MembershipType.RIDER,
    });

    if (!gate.ok) {
      return res.status(402).json({
        ok: false,
        error: membershipErrorMessage(gate.gate),
      });
    }

    const body = req.body ?? {};

    const originCity = body.originCity ? String(body.originCity) : "";
    const destinationCity = body.destinationCity ? String(body.destinationCity) : "";
    const departureTimeRaw = body.departureTime ? String(body.departureTime) : "";

    const originLat = toNumber(body.originLat);
    const originLng = toNumber(body.originLng);
    const destinationLat = toNumber(body.destinationLat);
    const destinationLng = toNumber(body.destinationLng);

    const passengerCount =
      typeof body.passengerCount === "number" && Number.isFinite(body.passengerCount)
        ? body.passengerCount
        : 1;

    const distanceMiles = toNumber(body.distanceMiles);

    if (
      !originCity ||
      !destinationCity ||
      !departureTimeRaw ||
      distanceMiles == null
    ) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    const departureTime = new Date(departureTimeRaw);
    if (Number.isNaN(departureTime.getTime())) {
      return res.status(400).json({ ok: false, error: "Invalid departureTime" });
    }

    // Note: your Prisma schema has originLat/originLng/destinationLat/destinationLng as required Float.
    // So we must ensure they’re present.
    if (
      originLat == null ||
      originLng == null ||
      destinationLat == null ||
      destinationLng == null
    ) {
      return res.status(400).json({
        ok: false,
        error: "Missing coordinates (originLat/originLng/destinationLat/destinationLng).",
      });
    }

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
        departureTime,
        passengerCount,
        distanceMiles,
        totalPriceCents,
        status: RideStatus.OPEN,
      },
    });

    return res.status(201).json({ ok: true, ride });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "Method not allowed" });
}
