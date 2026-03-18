// OATH: Clean replacement file
// FILE: pages/api/driver/dashboard-stats.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { BookingStatus, DisputeStatus } from "@prisma/client";

type DashboardRide = {
  id: string;
  departureTime: string;
  departureTimeMs: number;
  status: string;

  // driver-visible NET earnings after fee and refund handling
  totalPriceCents: number;

  originalTotalPriceCents?: number;
  refundAmountCents?: number;
  refundIssued?: boolean;
  refundIssuedAt?: string | null;

  distanceMiles: number;
  originCity: string;
  destinationCity: string;

  bookingId: string;
  paymentType: string | null;
};

type DashboardStatsResponse =
  | { ok: true; rides: DashboardRide[] }
  | { ok: false; error: string };

const PLATFORM_FEE_BPS = 1000;

function pickNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asNonNegativeCents(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

function computeFromBooking(b: any, rideEstimateCents: number | null) {
  const finalCents =
    pickNumber(b.finalAmountCents) ??
    pickNumber(b.finalTotalCents) ??
    pickNumber(b.totalChargedCents) ??
    pickNumber(b.totalPaidCents) ??
    null;

  if (typeof finalCents === "number") return Math.max(0, Math.round(finalCents));

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

  if (typeof base === "number") {
    return Math.max(0, Math.round(base + fee - disc));
  }

  return Math.max(0, Math.round(rideEstimateCents ?? 0));
}

function computeDriverNetFromGross(grossAmountCents: number) {
  const gross = Math.max(0, Math.round(grossAmountCents));
  const fee = Math.round(gross * (PLATFORM_FEE_BPS / 10000));
  const net = Math.max(0, gross - fee);

  return {
    grossAmountCents: gross,
    serviceFeeCents: fee,
    netAmountCents: net,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DashboardStatsResponse>
) {
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
    return res
      .status(403)
      .json({ ok: false, error: "Only drivers can access dashboard stats" });
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
        rideId: true,
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

    const rideIds = Array.from(
      new Set(bookings.map((b) => b.rideId).filter((v): v is string => Boolean(v)))
    );

    const disputes = rideIds.length
      ? await prisma.dispute.findMany({
          where: {
            rideId: { in: rideIds },
            driverId,
            status: DisputeStatus.RESOLVED_RIDER,
            refundIssued: true,
          },
          orderBy: {
            refundIssuedAt: "desc",
          },
          select: {
            rideId: true,
            refundIssued: true,
            refundAmountCents: true,
            refundIssuedAt: true,
          },
        })
      : [];

    const disputeByRideId = new Map<
      string,
      {
        refundIssued: boolean;
        refundAmountCents: number;
        refundIssuedAt: Date | null;
      }
    >();

    for (const d of disputes) {
      if (!disputeByRideId.has(d.rideId)) {
        disputeByRideId.set(d.rideId, {
          refundIssued: d.refundIssued,
          refundAmountCents: asNonNegativeCents(d.refundAmountCents),
          refundIssuedAt: d.refundIssuedAt ?? null,
        });
      }
    }

    const mapped: DashboardRide[] = bookings.map((b) => {
      const ride = b.ride;
      const estimate = pickNumber(ride.totalPriceCents) ?? null;

      const originalGrossAmountCents = computeFromBooking(b, estimate);
      const dispute = disputeByRideId.get(ride.id);

      const refundAmountCents = Math.min(
        asNonNegativeCents(dispute?.refundAmountCents),
        originalGrossAmountCents
      );

      const adjustedGrossAmountCents = Math.max(
        0,
        originalGrossAmountCents - refundAmountCents
      );

      const originalNetAmountCents =
        computeDriverNetFromGross(originalGrossAmountCents).netAmountCents;

      const adjustedNetAmountCents =
        computeDriverNetFromGross(adjustedGrossAmountCents).netAmountCents;

      return {
        id: ride.id,
        bookingId: b.id,
        paymentType: b.paymentType ? String(b.paymentType) : null,

        departureTime: ride.departureTime.toISOString(),
        departureTimeMs: ride.departureTime.getTime(),
        status: ride.status,

        totalPriceCents: adjustedNetAmountCents,
        originalTotalPriceCents: originalNetAmountCents,
        refundAmountCents,
        refundIssued: refundAmountCents > 0,
        refundIssuedAt: dispute?.refundIssuedAt
          ? dispute.refundIssuedAt.toISOString()
          : null,

        distanceMiles: ride.distanceMiles ?? 0,
        originCity: ride.originCity,
        destinationCity: ride.destinationCity,
      };
    });

    return res.status(200).json({ ok: true, rides: mapped });
  } catch (err) {
    console.error("Error loading dashboard stats", err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to load dashboard stats" });
  }
}
