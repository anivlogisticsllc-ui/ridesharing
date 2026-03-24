// OATH: Clean replacement file
// FILE: pages/api/rider/bookings.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { BookingStatus, DisputeStatus, PaymentType } from "@prisma/client";

type ApiBooking = {
  id: string;
  bookingId: string | null;
  status: BookingStatus;

  rideId: string;
  originCity: string;
  destinationCity: string;
  departureTime: string;
  rideStatus: string;

  driverName: string | null;
  driverPublicId: string | null;
  conversationId: string | null;

  isRideOnly: boolean;

  distanceMiles?: number | null;
  passengerCount?: number | null;
  tripStartedAt?: string | null;
  tripCompletedAt?: string | null;

  paymentType?: PaymentType | null;
  cashDiscountBps?: number | null;

  baseTotalPriceCents?: number | null;
  effectiveTotalPriceCents?: number | null;

  originalPaymentType?: PaymentType | null;
  originalCashDiscountBps?: number | null;
  cashNotPaidAt?: string | null;
  cashDiscountRevokedAt?: string | null;
  cashDiscountRevokedReason?: string | null;
  fallbackCardChargedAt?: string | null;

  refundIssued?: boolean | null;
  refundAmountCents?: number | null;
  refundIssuedAt?: string | null;
  disputeResolvedAt?: string | null;
};

type ApiResponse =
  | { ok: true; bookings: ApiBooking[] }
  | { ok: false; error: string };

function applyCashDiscount(
  baseCents: number,
  paymentType: PaymentType | null,
  cashDiscountBps: number | null
) {
  if (!Number.isFinite(baseCents)) return baseCents;
  if (paymentType !== PaymentType.CASH) return baseCents;

  const bps =
    typeof cashDiscountBps === "number" && Number.isFinite(cashDiscountBps)
      ? cashDiscountBps
      : 0;

  const multiplier = Math.max(0, 10000 - bps) / 10000;
  return Math.round(baseCents * multiplier);
}

function safeNonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function deriveFareCents(args: {
  finalAmountCents?: number | null;
  baseAmountCents?: number | null;
  rideTotalPriceCents?: number | null;
  paymentType?: PaymentType | null;
  cashDiscountBps?: number | null;
}) {
  const finalAmountCents = safeNonNegativeInt(args.finalAmountCents);
  if (finalAmountCents !== null) return finalAmountCents;

  const baseAmountCents = safeNonNegativeInt(args.baseAmountCents);
  if (baseAmountCents !== null) {
    return applyCashDiscount(
      baseAmountCents,
      args.paymentType ?? null,
      args.cashDiscountBps ?? null
    );
  }

  const rideAmountCents = safeNonNegativeInt(args.rideTotalPriceCents);
  if (rideAmountCents !== null) {
    return applyCashDiscount(
      rideAmountCents,
      args.paymentType ?? null,
      args.cashDiscountBps ?? null
    );
  }

  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const userId =
    typeof (session?.user as { id?: unknown } | undefined)?.id === "string"
      ? (session?.user as { id: string }).id
      : undefined;

  if (!userId) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  try {
    const bookings = await prisma.booking.findMany({
      where: { riderId: userId },
      orderBy: { createdAt: "desc" },
      include: {
        ride: {
          select: {
            id: true,
            originCity: true,
            destinationCity: true,
            departureTime: true,
            status: true,
            distanceMiles: true,
            totalPriceCents: true,
            passengerCount: true,
            tripStartedAt: true,
            tripCompletedAt: true,
            driver: {
              select: {
                name: true,
                publicId: true,
              },
            },
          },
        },
        conversation: {
          select: {
            id: true,
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
            riderId: userId,
            rideId: { in: rideIds },
            status: DisputeStatus.RESOLVED_RIDER,
            refundIssued: true,
          },
          orderBy: { refundIssuedAt: "desc" },
          select: {
            id: true,
            rideId: true,
            refundIssued: true,
            refundAmountCents: true,
            refundIssuedAt: true,
            resolvedAt: true,
          },
        })
      : [];

    const disputeByRideId = new Map<
      string,
      {
        refundIssued: boolean;
        refundAmountCents: number;
        refundIssuedAt: string | null;
        disputeResolvedAt: string | null;
      }
    >();

    for (const d of disputes) {
      if (disputeByRideId.has(d.rideId)) continue;

      disputeByRideId.set(d.rideId, {
        refundIssued: Boolean(d.refundIssued),
        refundAmountCents: safeNonNegativeInt(d.refundAmountCents) ?? 0,
        refundIssuedAt: d.refundIssuedAt ? d.refundIssuedAt.toISOString() : null,
        disputeResolvedAt: d.resolvedAt ? d.resolvedAt.toISOString() : null,
      });
    }

    const shapedBookings: ApiBooking[] = bookings.map((b) => {
      const rideFareCents = deriveFareCents({
        finalAmountCents: b.finalAmountCents,
        baseAmountCents: b.baseAmountCents,
        rideTotalPriceCents: b.ride.totalPriceCents,
        paymentType: b.paymentType ?? null,
        cashDiscountBps: b.cashDiscountBps ?? null,
      });

      const dispute = disputeByRideId.get(b.ride.id);
      const refundIssued = dispute?.refundIssued ?? false;
      const refundAmountCents = dispute?.refundAmountCents ?? 0;

      const originallyCash = b.originalPaymentType === PaymentType.CASH;
      const fallbackCharged = Boolean(
        originallyCash &&
          b.paymentType === PaymentType.CARD &&
          b.cashNotPaidAt &&
          b.fallbackCardChargedAt
      );

      const preservedCashAccounting =
        fallbackCharged && refundIssued && refundAmountCents > 0;

      const effectiveVisibleFareCents = preservedCashAccounting
        ? rideFareCents
        : rideFareCents;

      return {
        id: b.id,
        bookingId: b.id,
        status: b.status,

        rideId: b.ride.id,
        originCity: b.ride.originCity,
        destinationCity: b.ride.destinationCity,
        departureTime: b.ride.departureTime.toISOString(),
        rideStatus: b.ride.status,

        driverName: b.ride.driver?.name ?? null,
        driverPublicId: b.ride.driver?.publicId ?? null,
        conversationId: b.conversation?.id ?? null,

        isRideOnly: false,

        distanceMiles: b.ride.distanceMiles,
        passengerCount: b.ride.passengerCount,
        tripStartedAt: b.ride.tripStartedAt
          ? b.ride.tripStartedAt.toISOString()
          : null,
        tripCompletedAt: b.ride.tripCompletedAt
          ? b.ride.tripCompletedAt.toISOString()
          : null,

        paymentType: b.paymentType ?? null,
        cashDiscountBps: b.cashDiscountBps ?? null,

        baseTotalPriceCents: rideFareCents,
        effectiveTotalPriceCents: effectiveVisibleFareCents,

        originalPaymentType: b.originalPaymentType ?? null,
        originalCashDiscountBps: b.originalPaymentType === PaymentType.CASH
          ? b.cashDiscountBps ?? null
          : null,
        cashNotPaidAt: b.cashNotPaidAt ? b.cashNotPaidAt.toISOString() : null,
        cashDiscountRevokedAt: b.cashDiscountRevokedAt
          ? b.cashDiscountRevokedAt.toISOString()
          : null,
        cashDiscountRevokedReason: b.cashNotPaidReason ?? null,
        fallbackCardChargedAt: b.fallbackCardChargedAt
          ? b.fallbackCardChargedAt.toISOString()
          : null,

        refundIssued,
        refundAmountCents,
        refundIssuedAt: dispute?.refundIssuedAt ?? null,
        disputeResolvedAt: dispute?.disputeResolvedAt ?? null,
      };
    });

    const ridesWithoutBookings = await prisma.ride.findMany({
      where: {
        riderId: userId,
        bookings: { none: {} },
      },
      orderBy: { createdAt: "desc" },
      include: {
        driver: {
          select: {
            name: true,
            publicId: true,
          },
        },
      },
    });

    const shapedRideOnly: ApiBooking[] = ridesWithoutBookings.map((r) => {
      const total = safeNonNegativeInt(r.totalPriceCents);

      return {
        id: `ride-${r.id}`,
        bookingId: null,
        status: BookingStatus.PENDING,

        rideId: r.id,
        originCity: r.originCity,
        destinationCity: r.destinationCity,
        departureTime: r.departureTime.toISOString(),
        rideStatus: r.status,

        driverName: r.driver?.name ?? null,
        driverPublicId: r.driver?.publicId ?? null,
        conversationId: null,

        isRideOnly: true,

        distanceMiles: r.distanceMiles,
        passengerCount: r.passengerCount,
        tripStartedAt: r.tripStartedAt ? r.tripStartedAt.toISOString() : null,
        tripCompletedAt: r.tripCompletedAt ? r.tripCompletedAt.toISOString() : null,

        paymentType: null,
        cashDiscountBps: null,
        baseTotalPriceCents: total,
        effectiveTotalPriceCents: total,

        originalPaymentType: null,
        originalCashDiscountBps: null,
        cashNotPaidAt: null,
        cashDiscountRevokedAt: null,
        cashDiscountRevokedReason: null,
        fallbackCardChargedAt: null,

        refundIssued: false,
        refundAmountCents: 0,
        refundIssuedAt: null,
        disputeResolvedAt: null,
      };
    });

    const combined = [...shapedBookings, ...shapedRideOnly];

    combined.sort((a, b) => {
      const da = new Date(a.departureTime).getTime();
      const db = new Date(b.departureTime).getTime();
      return db - da;
    });

    return res.status(200).json({ ok: true, bookings: combined });
  } catch (err) {
    console.error("Error loading rider bookings:", err);
    return res.status(500).json({ ok: false, error: "Failed to load bookings" });
  }
}