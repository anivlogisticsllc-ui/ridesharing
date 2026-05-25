import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
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

    return NextResponse.json(
      {
        ok: true,
        bookings: bookings.map((booking) => {
          const dispute = booking.disputes[0] ?? null;

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
            conversationId: null,

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
            cashDiscountRevokedReason:
              booking.cashDiscountRevokedReason ?? null,
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
          };
        }),
      },
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error("Mobile rider bookings error:", err);

    return NextResponse.json(
      { ok: false, error: "Failed to load mobile rider bookings" },
      { status: 500, headers: corsHeaders }
    );
  }
}