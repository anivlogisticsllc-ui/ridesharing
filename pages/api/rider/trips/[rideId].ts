// OATH: Clean replacement file
// FILE: pages/api/rider/trips/[rideId].ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import { prisma } from "../../../../lib/prisma";
import { DisputeStatus, PaymentType } from "@prisma/client";

type TripStatus = "OPEN" | "IN_ROUTE" | "COMPLETED" | "CANCELLED" | string;
type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

type TripDto = {
  rideId: string;
  originAddress: string;
  destinationAddress: string;
  departureTime: string;

  bookingStatus: BookingStatus;
  rideStatus: TripStatus;

  distanceMiles: number | null;

  // rider-visible net amount after refund credit
  totalPriceCents: number | null;

  paymentType?: "CARD" | "CASH" | null;
  cashDiscountBps?: number | null;
  baseFareCents?: number | null;
  convenienceFeeCents?: number | null;
  discountCents?: number | null;
  finalTotalCents?: number | null;

  refundAmountCents?: number | null;
  refundIssued?: boolean;
  refundIssuedAt?: string | null;

  driverName: string | null;
  driverPublicId: string | null;

  requestedAt: string | null;
  tripStartedAt: string | null;
  tripCompletedAt: string | null;

  conversationId: string | null;
};

type ApiResponse =
  | { ok: true; trip: TripDto }
  | { ok: false; error: string };

function pickNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

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

  const clamped = Math.min(10000, Math.max(0, bps));
  const multiplier = (10000 - clamped) / 10000;

  return Math.round(baseCents * multiplier);
}

function deriveBookingMoney(b: any) {
  const baseFareCents =
    pickNumber(b.baseFareCents) ??
    pickNumber(b.baseAmountCents) ??
    null;

  const convenienceFeeCents =
    pickNumber(b.convenienceFeeCents) ??
    pickNumber(b.convenienceFeeAmountCents) ??
    pickNumber(b.feeCents) ??
    null;

  const discountCents =
    pickNumber(b.discountCents) ??
    pickNumber(b.promoDiscountCents) ??
    pickNumber(b.cashDiscountCents) ??
    null;

  const finalTotalCents =
    pickNumber(b.finalAmountCents) ??
    pickNumber(b.finalTotalCents) ??
    pickNumber(b.totalChargedCents) ??
    pickNumber(b.totalPaidCents) ??
    null;

  return {
    baseFareCents,
    convenienceFeeCents,
    discountCents,
    finalTotalCents,
  };
}

function computeFinalTotalCents(args: {
  booking: any | null;
  rideEstimateCents: number | null;
}): {
  totalPriceCents: number | null;
  baseFareCents: number | null;
  convenienceFeeCents: number | null;
  discountCents: number | null;
  finalTotalCents: number | null;
  paymentType: "CARD" | "CASH" | null;
  cashDiscountBps: number | null;
} {
  const booking = args.booking;
  const rideEstimateCents = args.rideEstimateCents;

  if (!booking) {
    return {
      totalPriceCents: rideEstimateCents,
      baseFareCents: null,
      convenienceFeeCents: null,
      discountCents: null,
      finalTotalCents: null,
      paymentType: null,
      cashDiscountBps: null,
    };
  }

  const anyB = booking as any;
  const paymentType: PaymentType | null =
    (booking.paymentType ?? null) as PaymentType | null;
  const cashDiscountBps =
    typeof anyB.cashDiscountBps === "number" ? anyB.cashDiscountBps : null;

  const {
    baseFareCents,
    convenienceFeeCents,
    discountCents,
    finalTotalCents,
  } = deriveBookingMoney(anyB);

  if (typeof finalTotalCents === "number") {
    return {
      totalPriceCents: finalTotalCents,
      baseFareCents,
      convenienceFeeCents,
      discountCents,
      finalTotalCents,
      paymentType: paymentType ?? null,
      cashDiscountBps,
    };
  }

  if (typeof baseFareCents === "number") {
    const discountedBase =
      paymentType === PaymentType.CASH
        ? applyCashDiscount(baseFareCents, paymentType, cashDiscountBps)
        : baseFareCents;

    const fee =
      typeof convenienceFeeCents === "number" ? convenienceFeeCents : 0;
    const disc = typeof discountCents === "number" ? discountCents : 0;
    const computedTotal = Math.max(0, discountedBase + fee - disc);

    return {
      totalPriceCents: computedTotal,
      baseFareCents,
      convenienceFeeCents,
      discountCents,
      finalTotalCents: computedTotal,
      paymentType: paymentType ?? null,
      cashDiscountBps,
    };
  }

  return {
    totalPriceCents: rideEstimateCents,
    baseFareCents: null,
    convenienceFeeCents: null,
    discountCents: null,
    finalTotalCents: rideEstimateCents,
    paymentType: paymentType ?? null,
    cashDiscountBps,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const userId = (session as any)?.user?.id as string | undefined;

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { rideId } = req.query;
    if (typeof rideId !== "string") {
      return res.status(400).json({ ok: false, error: "Invalid rideId parameter" });
    }

    const booking = await prisma.booking.findFirst({
      where: { riderId: userId, rideId },
      orderBy: { createdAt: "desc" },
      include: {
        ride: { include: { driver: true } },
        conversation: { select: { id: true } },
      },
    });

    if (!booking) {
      const ride = await prisma.ride.findUnique({
        where: { id: rideId },
        include: { driver: true },
      });

      if (!ride) {
        return res.status(404).json({ ok: false, error: "Trip not found" });
      }

      const tripFromRideOnly: TripDto = {
        rideId: ride.id,
        originAddress: (ride as any).originAddress ?? (ride as any).originCity ?? "",
        destinationAddress:
          (ride as any).destinationAddress ?? (ride as any).destinationCity ?? "",
        departureTime: ride.departureTime.toISOString(),

        bookingStatus: "PENDING",
        rideStatus: ((ride as any).status as TripStatus) ?? "OPEN",

        distanceMiles: (ride as any).distanceMiles ?? null,
        totalPriceCents: (ride as any).totalPriceCents ?? null,

        paymentType: null,
        cashDiscountBps: null,
        baseFareCents: null,
        convenienceFeeCents: null,
        discountCents: null,
        finalTotalCents: (ride as any).totalPriceCents ?? null,

        refundAmountCents: null,
        refundIssued: false,
        refundIssuedAt: null,

        driverName: ((ride as any).driver?.name as string | undefined) ?? null,
        driverPublicId: ((ride as any).driver?.publicId as string | undefined) ?? null,

        requestedAt: ride.createdAt?.toISOString?.() ?? null,
        tripStartedAt: (ride as any).tripStartedAt?.toISOString?.() ?? null,
        tripCompletedAt: (ride as any).tripCompletedAt?.toISOString?.() ?? null,

        conversationId: null,
      };

      return res.status(200).json({ ok: true, trip: tripFromRideOnly });
    }

    const ride = booking.ride as any;
    const rideEstimateCents = pickNumber(ride.totalPriceCents) ?? null;
    const money = computeFinalTotalCents({ booking, rideEstimateCents });

    const dispute = await prisma.dispute.findFirst({
      where: {
        riderId: userId,
        rideId: ride.id,
        status: DisputeStatus.RESOLVED_RIDER,
        refundIssued: true,
      },
      orderBy: {
        refundIssuedAt: "desc",
      },
      select: {
        refundIssued: true,
        refundAmountCents: true,
        refundIssuedAt: true,
      },
    });

    const refundAmountCents =
      typeof dispute?.refundAmountCents === "number" &&
      Number.isFinite(dispute.refundAmountCents)
        ? Math.max(0, Math.round(dispute.refundAmountCents))
        : 0;

    const riderVisibleTotalPriceCents =
      typeof money.totalPriceCents === "number"
        ? Math.max(0, money.totalPriceCents - refundAmountCents)
        : money.totalPriceCents;

    const trip: TripDto = {
      rideId: ride.id,
      originAddress: ride.originAddress ?? ride.originCity ?? "",
      destinationAddress: ride.destinationAddress ?? ride.destinationCity ?? "",
      departureTime: ride.departureTime.toISOString(),

      bookingStatus: booking.status as BookingStatus,
      rideStatus: (ride.status as TripStatus) ?? "OPEN",

      distanceMiles: ride.distanceMiles ?? null,

      // rider-visible charge after refund credit
      totalPriceCents: riderVisibleTotalPriceCents,

      paymentType: money.paymentType,
      cashDiscountBps: money.cashDiscountBps,
      baseFareCents: money.baseFareCents,
      convenienceFeeCents: money.convenienceFeeCents,
      discountCents: money.discountCents,

      // original stored total before refund credit
      finalTotalCents: money.finalTotalCents,

      refundAmountCents: refundAmountCents || null,
      refundIssued: Boolean(dispute?.refundIssued),
      refundIssuedAt: dispute?.refundIssuedAt
        ? dispute.refundIssuedAt.toISOString()
        : null,

      driverName: (ride.driver?.name as string | undefined) ?? null,
      driverPublicId: (ride.driver?.publicId as string | undefined) ?? null,

      requestedAt: booking.createdAt.toISOString(),
      tripStartedAt: ride.tripStartedAt?.toISOString?.() ?? null,
      tripCompletedAt: ride.tripCompletedAt?.toISOString?.() ?? null,

      conversationId:
        (booking as any).conversationId ?? (booking as any).conversation?.id ?? null,
    };

    return res.status(200).json({ ok: true, trip });
  } catch (err: any) {
    console.error("Error in /api/rider/trips/[rideId]:", err);
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ok: false, error: `Server error: ${message}` });
  }
}
