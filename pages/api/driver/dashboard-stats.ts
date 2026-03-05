// pages/api/driver/dashboard-stats.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { BookingStatus } from "@prisma/client";

type DashboardRide = {
  id: string;
  departureTime: string;
  departureTimeMs: number;
  status: string;

  // ✅ final charged (booking) amount
  totalPriceCents: number;

  distanceMiles: number;
  originCity: string;
  destinationCity: string;

  bookingId: string;
  paymentType: string | null;
};

type DashboardStatsResponse =
  | { ok: true; rides: DashboardRide[] }
  | { ok: false; error: string };

function pickNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function computeFromBooking(b: any, rideEstimateCents: number | null) {
  const finalCents =
    pickNumber(b.finalAmountCents) ??
    pickNumber(b.finalTotalCents) ??
    pickNumber(b.totalChargedCents) ??
    pickNumber(b.totalPaidCents) ??
    null;

  if (typeof finalCents === "number") return finalCents;

  const base =
    pickNumber(b.baseFareCents) ??
    pickNumber(b.baseAmountCents) ??
    null;

  const fee =
    pickNumber(b.convenienceFeeCents) ??
    pickNumber(b.convenienceFeeAmountCents) ??
    pickNumber(b.feeCents) ??
    0;

  const disc =
    pickNumber(b.discountCents) ??
    pickNumber(b.promoDiscountCents) ??
    pickNumber(b.cashDiscountCents) ??
    0;

  if (typeof base === "number") return Math.max(0, base + fee - disc);

  return rideEstimateCents ?? 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<DashboardStatsResponse>) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const user = session?.user as
    | ({ id?: string; role?: "RIDER" | "DRIVER" | "ADMIN" } & Record<string, any>)
    | undefined;

  if (!user?.id) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  if (user.role !== "DRIVER" && user.role !== "ADMIN") {
    return res.status(403).json({ ok: false, error: "Only drivers can access dashboard stats" });
  }

  const driverId = user.id;

  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);

  try {
    const bookings = await prisma.booking.findMany({
      where: {
        status: { in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED] },
        ride: {
          driverId,
          status: "COMPLETED",
          departureTime: { gte: since },
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        paymentType: true,
        baseAmountCents: true,
        discountCents: true,
        finalAmountCents: true,
        ride: {
          select: {
            id: true,
            departureTime: true,
            status: true,
            totalPriceCents: true,
            distanceMiles: true,
            originCity: true,
            destinationCity: true,
          },
        },
      },
    });

    const mapped: DashboardRide[] = bookings.map((b) => {
      const ride = b.ride;
      const estimate = pickNumber(ride.totalPriceCents) ?? null;

      return {
        id: ride.id,
        bookingId: b.id,
        paymentType: b.paymentType ? String(b.paymentType) : null,

        departureTime: ride.departureTime.toISOString(),
        departureTimeMs: ride.departureTime.getTime(),
        status: ride.status,

        totalPriceCents: computeFromBooking(b, estimate),

        distanceMiles: ride.distanceMiles ?? 0,
        originCity: ride.originCity,
        destinationCity: ride.destinationCity,
      };
    });

    return res.status(200).json({ ok: true, rides: mapped });
  } catch (err) {
    console.error("Error loading dashboard stats", err);
    return res.status(500).json({ ok: false, error: "Failed to load dashboard stats" });
  }
}