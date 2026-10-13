// app/api/mobile/rider/bookings/route.ts

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import {
  PaymentType,
  RidePaymentStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

const JWT_SECRET = process.env.MOBILE_JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("MOBILE_JWT_SECRET is not configured");
}

const secret = new TextEncoder().encode(JWT_SECRET);

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:8081",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type MobileJwtPayload = {
  sub?: string;
  role?: string;
  email?: string;
};

type MobileBooking = {
  id: string;
  bookingId: string | null;
  status: string;
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

  paymentType?: "CARD" | "CASH" | null;
  cashDiscountBps?: number | null;

  baseTotalPriceCents?: number | null;
  effectiveTotalPriceCents?: number | null;
  totalPriceCents?: number | null;

  originalPaymentType?: "CARD" | "CASH" | null;
  originalCashDiscountBps?: number | null;
  cashNotPaidAt?: string | null;
  cashDiscountRevokedAt?: string | null;
  cashDiscountRevokedReason?: string | null;
  fallbackCardChargedAt?: string | null;

  refundIssued?: boolean | null;
  refundAmountCents?: number | null;
  refundIssuedAt?: string | null;
  disputeResolvedAt?: string | null;

  tipStatus?: string | null;
  tipAmountCents?: number | null;
  tipPercent?: number | null;
  tipEligibleUntil?: string | null;
  tipSelectedAt?: string | null;
  tipChargedAt?: string | null;
  tipSkippedAt?: string | null;
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

async function getMobileUserId(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("authorization") || "";

  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();

  if (!token) {
    return null;
  }

  try {
    const verified = await jwtVerify(token, secret);
    const payload = verified.payload as MobileJwtPayload;

    return typeof payload.sub === "string" && payload.sub
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

function scoreBooking(item: MobileBooking) {
  if (item.status === "COMPLETED" || item.rideStatus === "COMPLETED") {
    return 30;
  }

  if (item.rideStatus === "IN_ROUTE") {
    return 20;
  }

  if (item.rideStatus === "ACCEPTED" || item.status === "CONFIRMED") {
    return 10;
  }

  return 0;
}

function dedupeByRideId(items: MobileBooking[]): MobileBooking[] {
  const byRideId = new Map<string, MobileBooking>();

  for (const item of items) {
    const existing = byRideId.get(item.rideId);

    if (!existing) {
      byRideId.set(item.rideId, item);
      continue;
    }

    const existingHasBooking = Boolean(existing.bookingId);
    const itemHasBooking = Boolean(item.bookingId);

    if (itemHasBooking && !existingHasBooking) {
      byRideId.set(item.rideId, item);
      continue;
    }

    if (existingHasBooking && !itemHasBooking) {
      continue;
    }

    if (scoreBooking(item) > scoreBooking(existing)) {
      byRideId.set(item.rideId, item);
    }
  }

  return Array.from(byRideId.values());
}

export async function GET(req: NextRequest) {
  try {
    const riderId = await getMobileUserId(req);

    if (!riderId) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401, headers: corsHeaders }
      );
    }

    const bookings = await prisma.booking.findMany({
      where: {
        riderId,
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        ride: {
          select: {
            id: true,
            originCity: true,
            destinationCity: true,
            departureTime: true,
            status: true,
            distanceMiles: true,
            passengerCount: true,
            totalPriceCents: true,
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
        disputes: {
          select: {
            refundIssued: true,
            refundAmountCents: true,
            refundIssuedAt: true,
            resolvedAt: true,
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
    });

    const rideIds = Array.from(
      new Set(bookings.map((booking) => booking.ride.id))
    );

    const cardPayments =
      rideIds.length > 0
        ? await prisma.ridePayment.findMany({
            where: {
              riderId,
              rideId: {
                in: rideIds,
              },
              paymentType: PaymentType.CARD,
              status: {
                in: [
                  RidePaymentStatus.AUTHORIZED,
                  RidePaymentStatus.PENDING,
                  RidePaymentStatus.SUCCEEDED,
                ],
              },
            },
            orderBy: {
              createdAt: "desc",
            },
            select: {
              rideId: true,
              tipStatus: true,
              tipAmountCents: true,
              tipPercent: true,
              tipEligibleUntil: true,
              tipSelectedAt: true,
              tipChargedAt: true,
              tipSkippedAt: true,
            },
          })
        : [];

    const latestCardPaymentByRide = new Map<
      string,
      (typeof cardPayments)[number]
    >();

    for (const payment of cardPayments) {
      if (!latestCardPaymentByRide.has(payment.rideId)) {
        latestCardPaymentByRide.set(payment.rideId, payment);
      }
    }

    const shapedBookings: MobileBooking[] = bookings.map((booking) => {
      const dispute = booking.disputes[0] ?? null;
      const cardPayment =
        latestCardPaymentByRide.get(booking.ride.id) ?? null;

      return {
        id: booking.id,
        bookingId: booking.id,
        status: booking.status,

        rideId: booking.ride.id,
        originCity: booking.ride.originCity,
        destinationCity: booking.ride.destinationCity,
        departureTime: booking.ride.departureTime.toISOString(),
        rideStatus: booking.ride.status,

        driverName: booking.ride.driver?.name ?? null,
        driverPublicId: booking.ride.driver?.publicId ?? null,
        conversationId: booking.conversation?.id ?? null,

        isRideOnly: false,

        distanceMiles: booking.ride.distanceMiles ?? null,
        passengerCount: booking.ride.passengerCount ?? null,
        tripStartedAt: booking.ride.tripStartedAt
          ? booking.ride.tripStartedAt.toISOString()
          : null,
        tripCompletedAt: booking.ride.tripCompletedAt
          ? booking.ride.tripCompletedAt.toISOString()
          : null,

        paymentType: booking.paymentType ?? null,
        cashDiscountBps: booking.cashDiscountBps ?? null,

        baseTotalPriceCents:
          booking.baseAmountCents ?? booking.ride.totalPriceCents ?? null,
        effectiveTotalPriceCents:
          booking.finalAmountCents ?? booking.ride.totalPriceCents ?? null,
        totalPriceCents: booking.ride.totalPriceCents ?? null,

        originalPaymentType: booking.originalPaymentType ?? null,
        originalCashDiscountBps: booking.originalCashDiscountBps ?? null,
        cashNotPaidAt: booking.cashNotPaidAt
          ? booking.cashNotPaidAt.toISOString()
          : null,
        cashDiscountRevokedAt: booking.cashDiscountRevokedAt
          ? booking.cashDiscountRevokedAt.toISOString()
          : null,
        cashDiscountRevokedReason: booking.cashDiscountRevokedReason ?? null,
        fallbackCardChargedAt: booking.fallbackCardChargedAt
          ? booking.fallbackCardChargedAt.toISOString()
          : null,

        refundIssued: dispute?.refundIssued ?? null,
        refundAmountCents: dispute?.refundAmountCents ?? null,
        refundIssuedAt: dispute?.refundIssuedAt
          ? dispute.refundIssuedAt.toISOString()
          : null,
        disputeResolvedAt: dispute?.resolvedAt
          ? dispute.resolvedAt.toISOString()
          : null,

        tipStatus: cardPayment?.tipStatus ?? null,
        tipAmountCents: cardPayment?.tipAmountCents ?? null,
        tipPercent: cardPayment?.tipPercent ?? null,
        tipEligibleUntil: cardPayment?.tipEligibleUntil
          ? cardPayment.tipEligibleUntil.toISOString()
          : null,
        tipSelectedAt: cardPayment?.tipSelectedAt
          ? cardPayment.tipSelectedAt.toISOString()
          : null,
        tipChargedAt: cardPayment?.tipChargedAt
          ? cardPayment.tipChargedAt.toISOString()
          : null,
        tipSkippedAt: cardPayment?.tipSkippedAt
          ? cardPayment.tipSkippedAt.toISOString()
          : null,
      };
    });

    const ridesWithoutBookings = await prisma.ride.findMany({
      where: {
        riderId,
        status: {
          in: ["OPEN", "ACCEPTED", "IN_ROUTE"],
        },
        bookings: {
          none: {},
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        driver: {
          select: {
            name: true,
            publicId: true,
          },
        },
      },
    });

    const shapedRideOnly: MobileBooking[] = ridesWithoutBookings.map(
      (ride) => {
        const totalPriceCents =
          typeof ride.totalPriceCents === "number"
            ? ride.totalPriceCents
            : null;

        return {
          id: `ride-${ride.id}`,
          bookingId: null,
          status: "PENDING",

          rideId: ride.id,
          originCity: ride.originCity,
          destinationCity: ride.destinationCity,
          departureTime: ride.departureTime.toISOString(),
          rideStatus: ride.status,

          driverName: ride.driver?.name ?? null,
          driverPublicId: ride.driver?.publicId ?? null,
          conversationId: null,

          isRideOnly: true,

          distanceMiles: ride.distanceMiles ?? null,
          passengerCount: ride.passengerCount ?? null,
          tripStartedAt: ride.tripStartedAt
            ? ride.tripStartedAt.toISOString()
            : null,
          tripCompletedAt: ride.tripCompletedAt
            ? ride.tripCompletedAt.toISOString()
            : null,

          paymentType: null,
          cashDiscountBps: null,

          baseTotalPriceCents: totalPriceCents,
          effectiveTotalPriceCents: totalPriceCents,
          totalPriceCents,

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
          tipEligibleUntil: null,
          tipSelectedAt: null,
          tipChargedAt: null,
          tipSkippedAt: null,
        };
      }
    );

    const combined = dedupeByRideId([
      ...shapedBookings,
      ...shapedRideOnly,
    ]);

    combined.sort((a, b) => {
      const aTime = new Date(a.departureTime).getTime();
      const bTime = new Date(b.departureTime).getTime();
      return bTime - aTime;
    });

    return NextResponse.json(
      {
        ok: true,
        bookings: combined,
      },
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error("Mobile rider bookings error:", err);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to load mobile rider bookings",
      },
      { status: 500, headers: corsHeaders }
    );
  }
}