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

function deriveOriginalAmountCents(b: {
  finalAmountCents?: number | null;
  baseAmountCents?: number | null;
  ride: { totalPriceCents?: number | null };
  paymentType?: PaymentType | null;
  cashDiscountBps?: number | null;
}) {
  const finalAmountCents = safeNonNegativeInt(b.finalAmountCents);
  if (finalAmountCents !== null) return finalAmountCents;

  const baseAmountCents = safeNonNegativeInt(b.baseAmountCents);
  if (baseAmountCents !== null) {
    return applyCashDiscount(
      baseAmountCents,
      b.paymentType ?? null,
      b.cashDiscountBps ?? null
    );
  }

  const rideAmountCents = safeNonNegativeInt(b.ride.totalPriceCents);
  if (rideAmountCents !== null) {
    return applyCashDiscount(
      rideAmountCents,
      b.paymentType ?? null,
      b.cashDiscountBps ?? null
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
            refundAmountCents: true,
          },
        })
      : [];

    const refundByRideId = new Map<string, number>();

    for (const d of disputes) {
      const refund = safeNonNegativeInt(d.refundAmountCents) ?? 0;
      if (!refundByRideId.has(d.rideId)) {
        refundByRideId.set(d.rideId, refund);
      }
    }

    const shapedBookings: ApiBooking[] = bookings.map((b) => {
      const originalAmountCents = deriveOriginalAmountCents({
        finalAmountCents: b.finalAmountCents,
        baseAmountCents: b.baseAmountCents,
        ride: { totalPriceCents: b.ride.totalPriceCents },
        paymentType: b.paymentType ?? null,
        cashDiscountBps: b.cashDiscountBps ?? null,
      });

      const refundAmountCents = refundByRideId.get(b.ride.id) ?? 0;

      const effectiveAfterRefund =
        typeof originalAmountCents === "number"
          ? Math.max(0, originalAmountCents - refundAmountCents)
          : null;

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

        // original charged amount before rider-favor refund
        baseTotalPriceCents: originalAmountCents,

        // rider-visible amount after refund credit
        effectiveTotalPriceCents: effectiveAfterRefund,
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

    const shapedRideOnly: ApiBooking[] = ridesWithoutBookings.map((r) => ({
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
      baseTotalPriceCents: safeNonNegativeInt(r.totalPriceCents),
      effectiveTotalPriceCents: safeNonNegativeInt(r.totalPriceCents),
    }));

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
