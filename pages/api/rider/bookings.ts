// OATH: Clean replacement file
// FILE: pages/api/rider/bookings.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import {
  BookingStatus,
  DisputeStatus,
  PaymentType,
  RidePaymentStatus,
  TipStatus,
} from "@prisma/client";

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

  tipStatus?: TipStatus | null;
  tipAmountCents?: number | null;
  tipPercent?: number | null;
  tipChargedAt?: string | null;
  tipSkippedAt?: string | null;
  tipEligibleUntil?: string | null;
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

function deriveStaticFareCents(args: {
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
      take: 50,
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

    const ridePayments = rideIds.length
      ? await prisma.ridePayment.findMany({
          where: {
            rideId: { in: rideIds },
            riderId: userId,
            paymentType: PaymentType.CARD,
            status: {
              in: [
                RidePaymentStatus.AUTHORIZED,
                RidePaymentStatus.PENDING,
                RidePaymentStatus.SUCCEEDED,
              ],
            },
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            rideId: true,
            createdAt: true,
            status: true,
            baseAmountCents: true,
            finalAmountCents: true,
            capturedAt: true,
            tipStatus: true,
            tipAmountCents: true,
            tipPercent: true,
            tipChargedAt: true,
            tipSkippedAt: true,
            tipEligibleUntil: true,
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

    const latestRidePaymentByRideId = new Map<
      string,
      {
        paymentStatus: RidePaymentStatus;
        baseAmountCents: number | null;
        finalAmountCents: number | null;
        capturedAt: string | null;
        tipStatus: TipStatus | null;
        tipAmountCents: number | null;
        tipPercent: number | null;
        tipChargedAt: string | null;
        tipSkippedAt: string | null;
        tipEligibleUntil: string | null;
      }
    >();

    for (const p of ridePayments) {
      if (latestRidePaymentByRideId.has(p.rideId)) continue;

      latestRidePaymentByRideId.set(p.rideId, {
        paymentStatus: p.status,
        baseAmountCents: safeNonNegativeInt(p.baseAmountCents),
        finalAmountCents: safeNonNegativeInt(p.finalAmountCents),
        capturedAt: p.capturedAt ? p.capturedAt.toISOString() : null,
        tipStatus: p.tipStatus ?? null,
        tipAmountCents: safeNonNegativeInt(p.tipAmountCents) ?? 0,
        tipPercent: safeNonNegativeInt(p.tipPercent),
        tipChargedAt: p.tipChargedAt ? p.tipChargedAt.toISOString() : null,
        tipSkippedAt: p.tipSkippedAt ? p.tipSkippedAt.toISOString() : null,
        tipEligibleUntil: p.tipEligibleUntil ? p.tipEligibleUntil.toISOString() : null,
      });
    }

    const shapedBookings: ApiBooking[] = bookings.map((b) => {
      const payment = latestRidePaymentByRideId.get(b.ride.id);

      const staticFareCents = deriveStaticFareCents({
        finalAmountCents: (b as any).finalAmountCents,
        baseAmountCents: (b as any).baseAmountCents,
        rideTotalPriceCents: b.ride.totalPriceCents,
        paymentType: b.paymentType ?? null,
        cashDiscountBps: b.cashDiscountBps ?? null,
      });

      const liveRideFareCents = applyCashDiscount(
        safeNonNegativeInt(b.ride.totalPriceCents) ?? 0,
        b.paymentType ?? null,
        b.cashDiscountBps ?? null
      );

      const displayBaseFareCents =
        payment?.baseAmountCents ??
        safeNonNegativeInt((b as any).baseAmountCents) ??
        staticFareCents;

      let displayEffectiveFareCents: number | null;

      if (b.ride.status === "IN_ROUTE") {
        displayEffectiveFareCents = liveRideFareCents;
      } else if (
        b.paymentType === PaymentType.CARD &&
        payment?.paymentStatus === RidePaymentStatus.SUCCEEDED
      ) {
        displayEffectiveFareCents =
          payment.finalAmountCents ?? payment.baseAmountCents ?? staticFareCents;
      } else {
        displayEffectiveFareCents = staticFareCents;
      }

      const dispute = disputeByRideId.get(b.ride.id);
      const refundIssued = dispute?.refundIssued ?? false;
      const refundAmountCents = dispute?.refundAmountCents ?? 0;

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

        baseTotalPriceCents: displayBaseFareCents,
        effectiveTotalPriceCents: displayEffectiveFareCents,

        originalPaymentType: (b as any).originalPaymentType ?? null,
        originalCashDiscountBps:
          (b as any).originalPaymentType === PaymentType.CASH
            ? b.cashDiscountBps ?? null
            : null,
        cashNotPaidAt: (b as any).cashNotPaidAt
          ? (b as any).cashNotPaidAt.toISOString()
          : null,
        cashDiscountRevokedAt: (b as any).cashDiscountRevokedAt
          ? (b as any).cashDiscountRevokedAt.toISOString()
          : null,
        cashDiscountRevokedReason: (b as any).cashNotPaidReason ?? null,
        fallbackCardChargedAt: (b as any).fallbackCardChargedAt
          ? (b as any).fallbackCardChargedAt.toISOString()
          : null,

        refundIssued,
        refundAmountCents,
        refundIssuedAt: dispute?.refundIssuedAt ?? null,
        disputeResolvedAt: dispute?.disputeResolvedAt ?? null,

        tipStatus: payment?.tipStatus ?? null,
        tipAmountCents: payment?.tipAmountCents ?? 0,
        tipPercent: payment?.tipPercent ?? null,
        tipChargedAt: payment?.tipChargedAt ?? null,
        tipSkippedAt: payment?.tipSkippedAt ?? null,
        tipEligibleUntil: payment?.tipEligibleUntil ?? null,
      };
    });

    const ridesWithoutBookings = await prisma.ride.findMany({
      where: {
        riderId: userId,
        status: { in: ["OPEN", "ACCEPTED", "IN_ROUTE"] },
        bookings: { none: {} },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
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

        tipStatus: null,
        tipAmountCents: null,
        tipPercent: null,
        tipChargedAt: null,
        tipSkippedAt: null,
        tipEligibleUntil: null,
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