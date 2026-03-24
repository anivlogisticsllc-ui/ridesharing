// OATH: Clean replacement file
// FILE: pages/api/driver/dashboard-stats.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { DisputeStatus, PaymentType, RideStatus } from "@prisma/client";

type DashboardRide = {
  id: string;

  // keep original departure timestamp for reference/display if needed
  departureTime: string;
  departureTimeMs: number;

  // use this for dashboard filtering/sorting so it matches portal behavior
  effectiveTime: string;
  effectiveTimeMs: number;

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

  // optional debug/supporting fields
  originalPaymentType?: string | null;
  cashNotPaidAt?: string | null;
  fallbackCardChargedAt?: string | null;
  settlementLabel?: string | null;
};

type DashboardStatsResponse =
  | { ok: true; rides: DashboardRide[] }
  | { ok: false; error: string };

const PLATFORM_FEE_BPS = 1000;

function pickNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asNonNegativeCents(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.max(0, Math.round(v))
    : 0;
}

function computeFromBooking(
  b: {
    finalAmountCents?: number | null;
    finalTotalCents?: number | null;
    totalChargedCents?: number | null;
    totalPaidCents?: number | null;
    baseFareCents?: number | null;
    baseAmountCents?: number | null;
    convenienceFeeCents?: number | null;
    convenienceFeeAmountCents?: number | null;
    feeCents?: number | null;
    discountCents?: number | null;
    promoDiscountCents?: number | null;
    cashDiscountCents?: number | null;
  },
  rideEstimateCents: number | null
) {
  const finalCents =
    pickNumber(b.finalAmountCents) ??
    pickNumber(b.finalTotalCents) ??
    pickNumber(b.totalChargedCents) ??
    pickNumber(b.totalPaidCents) ??
    null;

  if (typeof finalCents === "number") {
    return Math.max(0, Math.round(finalCents));
  }

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

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");

  const session = await getServerSession(req, res, authOptions);
  const user = session?.user as
    | ({ id?: string; role?: "RIDER" | "DRIVER" | "ADMIN" } & Record<string, unknown>)
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

  try {
    const rides = await prisma.ride.findMany({
      where: {
        driverId,
        status: RideStatus.COMPLETED,
      },
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        id: true,
        departureTime: true,
        updatedAt: true,
        status: true,
        totalPriceCents: true,
        distanceMiles: true,
        originCity: true,
        destinationCity: true,
      },
    });

    const rideIds = rides.map((r) => r.id);

    const bookings = rideIds.length
      ? await prisma.booking.findMany({
          where: {
            rideId: { in: rideIds },
          },
          orderBy: [{ rideId: "asc" }, { updatedAt: "desc" }],
          select: {
            id: true,
            rideId: true,
            paymentType: true,
            originalPaymentType: true,
            baseAmountCents: true,
            discountCents: true,
            finalAmountCents: true,
            cashNotPaidAt: true,
            fallbackCardChargedAt: true,
            updatedAt: true,
          },
        })
      : [];

    const latestBookingByRideId = new Map<string, (typeof bookings)[number]>();
    for (const b of bookings) {
      if (!latestBookingByRideId.has(b.rideId)) {
        latestBookingByRideId.set(b.rideId, b);
      }
    }

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

    const mapped: DashboardRide[] = rides.map((ride) => {
      const booking = latestBookingByRideId.get(ride.id);
      const dispute = disputeByRideId.get(ride.id);

      const estimate = pickNumber(ride.totalPriceCents) ?? null;
      const originalGrossAmountCents = computeFromBooking(
        {
          finalAmountCents: booking?.finalAmountCents ?? null,
          baseAmountCents: booking?.baseAmountCents ?? null,
          discountCents: booking?.discountCents ?? null,
        },
        estimate
      );

      const refundAmountCents = Math.min(
        asNonNegativeCents(dispute?.refundAmountCents),
        originalGrossAmountCents
      );

      const originalNetAmountCents =
        computeDriverNetFromGross(originalGrossAmountCents).netAmountCents;

      const adjustedGrossAmountCents = Math.max(
        0,
        originalGrossAmountCents - refundAmountCents
      );

      const adjustedNetAmountCents =
        computeDriverNetFromGross(adjustedGrossAmountCents).netAmountCents;

      const originallyCash = booking?.originalPaymentType === PaymentType.CASH;
      const fallbackCharged = Boolean(
        originallyCash &&
          booking?.paymentType === PaymentType.CARD &&
          booking?.cashNotPaidAt &&
          booking?.fallbackCardChargedAt
      );

      const refundedAfterDispute = refundAmountCents > 0;
      const preservedCashAccounting = fallbackCharged && refundedAfterDispute;

      const effectiveNetAmountCents = preservedCashAccounting
        ? originalNetAmountCents
        : adjustedNetAmountCents;

      const settlementLabel = preservedCashAccounting
        ? "Cash preserved"
        : refundedAfterDispute
        ? "Refund adjusted"
        : "Standard payout";

      const effectiveDate =
        ride.updatedAt ??
        booking?.updatedAt ??
        ride.departureTime;

      return {
        id: ride.id,
        bookingId: booking?.id ?? ride.id,
        paymentType: booking?.paymentType ? String(booking.paymentType) : null,
        originalPaymentType: booking?.originalPaymentType
          ? String(booking.originalPaymentType)
          : null,

        departureTime: ride.departureTime.toISOString(),
        departureTimeMs: ride.departureTime.getTime(),

        effectiveTime: effectiveDate.toISOString(),
        effectiveTimeMs: effectiveDate.getTime(),

        status: String(ride.status),

        totalPriceCents: effectiveNetAmountCents,
        originalTotalPriceCents: originalNetAmountCents,
        refundAmountCents,
        refundIssued: refundAmountCents > 0,
        refundIssuedAt: dispute?.refundIssuedAt
          ? dispute.refundIssuedAt.toISOString()
          : null,

        distanceMiles: ride.distanceMiles ?? 0,
        originCity: ride.originCity ?? "",
        destinationCity: ride.destinationCity ?? "",

        cashNotPaidAt: booking?.cashNotPaidAt
          ? booking.cashNotPaidAt.toISOString()
          : null,
        fallbackCardChargedAt: booking?.fallbackCardChargedAt
          ? booking.fallbackCardChargedAt.toISOString()
          : null,
        settlementLabel,
      };
    });

    mapped.sort((a, b) => b.effectiveTimeMs - a.effectiveTimeMs);

    return res.status(200).json({ ok: true, rides: mapped });
  } catch (err) {
    console.error("Error loading dashboard stats", err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to load dashboard stats" });
  }
}