// pages/api/driver/update-meter.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { RideStatus, UserRole } from "@prisma/client";

import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

type ApiResponse = { ok: true } | { ok: false; error: string };

type RequestBody = {
  rideId?: string;
  distanceMiles?: number;
  fareCents?: number;
};

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function asNonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const driverId = (session?.user as { id?: string } | undefined)?.id;
  const role = (session?.user as { role?: UserRole } | undefined)?.role;

  if (!driverId) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  if (role !== UserRole.DRIVER) {
    return res.status(403).json({
      ok: false,
      error: "Only drivers can update live meter data.",
    });
  }

  const { rideId, distanceMiles, fareCents } = (req.body ?? {}) as RequestBody;

  if (typeof rideId !== "string" || !rideId.trim()) {
    return res.status(400).json({ ok: false, error: "rideId is required" });
  }

  const safeDistanceMiles = asNonNegativeNumber(distanceMiles);
  const safeFareCents = asNonNegativeInt(fareCents);

  if (safeDistanceMiles === null && safeFareCents === null) {
    return res.status(400).json({ ok: false, error: "Nothing to update" });
  }

  try {
    const ride = await prisma.ride.findFirst({
      where: {
        id: rideId,
        driverId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!ride) {
      return res.status(404).json({
        ok: false,
        error: "Ride not found for this driver.",
      });
    }

    // Harmless no-op. Prevents noisy 400s when completion already changed status.
    if (ride.status !== RideStatus.IN_ROUTE) {
      return res.status(200).json({ ok: true });
    }

    await prisma.ride.update({
      where: { id: ride.id },
      data: {
        ...(safeDistanceMiles !== null ? { distanceMiles: safeDistanceMiles } : {}),
        ...(safeFareCents !== null ? { totalPriceCents: safeFareCents } : {}),
      },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Error updating live meter:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to update live meter.",
    });
  }
}