// app/api/mobile/receipt/[bookingId]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import {
  PaymentType,
  RidePaymentStatus,
  RideStatus,
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
  "Cache-Control": "no-store, max-age=0",
};

type MobileJwtPayload = {
  sub?: string;
};

function asCents(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.max(0, Math.round(v));
  }

  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  }

  return 0;
}

function paymentLabel(
  pt: PaymentType | null | undefined
): "CARD" | "CASH" | null {
  if (pt === PaymentType.CARD) return "CARD";
  if (pt === PaymentType.CASH) return "CASH";
  return null;
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

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ bookingId: string }> }
) {
  const userId = await getMobileUserId(req);

  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated" },
      { status: 401, headers: corsHeaders }
    );
  }

  const { bookingId } = await context.params;

  if (!bookingId) {
    return NextResponse.json(
      { ok: false, error: "Missing bookingId" },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    const booking = await prisma.booking.findUnique({
      where: {
        id: bookingId,
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        riderId: true,
        riderName: true,
        riderEmail: true,

        paymentType: true,
        originalPaymentType: true,
        cashDiscountBps: true,
        originalCashDiscountBps: true,
        currency: true,

        baseAmountCents: true,
        discountCents: true,
        finalAmountCents: true,

        cashNotPaidAt: true,
        cashNotPaidByUserId: true,
        cashNotPaidReportedById: true,
        cashNotPaidReason: true,
        cashNotPaidNote: true,
        cashDiscountRevokedAt: true,
        cashDiscountRevokedReason: true,
        fallbackCardChargedAt: true,
        stripePaymentIntentId: true,
        stripePaymentIntentStatus: true,

        ride: {
          select: {
            id: true,
            status: true,
            originCity: true,
            destinationCity: true,
            departureTime: true,
            tripStartedAt: true,
            tripCompletedAt: true,
            passengerCount: true,
            distanceMiles: true,
            totalPriceCents: true,
            driverId: true,
            rider: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            driver: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!booking?.ride) {
      return NextResponse.json(
        { ok: false, error: "Receipt not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    const ride = booking.ride;

    if (ride.status !== RideStatus.COMPLETED) {
      return NextResponse.json(
        {
          ok: false,
          error: "Receipt is only available for completed rides.",
        },
        { status: 400, headers: corsHeaders }
      );
    }

    const isRider =
      booking.riderId === userId ||
      ride.rider?.id === userId;

    if (!isRider) {
      return NextResponse.json(
        { ok: false, error: "Not allowed" },
        { status: 403, headers: corsHeaders }
      );
    }

    const latestRidePayment = await prisma.ridePayment.findFirst({
      where: {
        rideId: ride.id,
        riderId: booking.riderId ?? undefined,
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
        id: true,
        status: true,
        amountCents: true,
        baseAmountCents: true,
        discountCents: true,
        finalAmountCents: true,
        capturedAt: true,
        paymentType: true,
        tipAmountCents: true,
        tipPercent: true,
        tipStatus: true,
        tipChargedAt: true,
        tipSkippedAt: true,
      },
    });

    const fallbackCharged = Boolean(
      booking.cashNotPaidAt &&
      booking.fallbackCardChargedAt
    );

    const originallyCash =
      booking.originalPaymentType === PaymentType.CASH;

    const baseFareCents =
      asCents(latestRidePayment?.baseAmountCents) ||
      asCents(booking.baseAmountCents) ||
      asCents(ride.totalPriceCents);

    const discountCents = fallbackCharged
      ? 0
      : asCents(latestRidePayment?.discountCents) ||
        asCents(booking.discountCents);

    const tipCents = asCents(
      latestRidePayment?.tipAmountCents
    );

    const totalChargedCents =
      asCents(latestRidePayment?.finalAmountCents) ||
      asCents(booking.finalAmountCents) ||
      Math.max(
        0,
        baseFareCents - discountCents + tipCents
      );

    const subtotalAfterDiscount = Math.max(
      0,
      baseFareCents - discountCents
    );

    const convenienceFeeCents = Math.max(
      0,
      totalChargedCents -
        subtotalAfterDiscount -
        tipCents
    );

    let displayedPaymentLabel: string | null = null;

    if (fallbackCharged) {
      displayedPaymentLabel =
        "CARD (fallback after unpaid CASH)";
    } else if (
      originallyCash &&
      booking.paymentType === PaymentType.CASH
    ) {
      displayedPaymentLabel = "CASH";
    } else {
      displayedPaymentLabel = paymentLabel(
        booking.paymentType
      );
    }

    return NextResponse.json(
      {
        ok: true,
        receipt: {
          booking: {
            id: booking.id,
            status: booking.status,
            createdAt: booking.createdAt.toISOString(),
            paymentType: paymentLabel(booking.paymentType),
            originalPaymentType: paymentLabel(
              booking.originalPaymentType
            ),
            displayedPaymentLabel,
            cashDiscountBps:
              booking.cashDiscountBps ?? 0,
            originalCashDiscountBps:
              booking.originalCashDiscountBps ?? 0,
            currency:
              (booking.currency || "USD").toUpperCase(),
            riderName:
              booking.riderName ??
              ride.rider?.name ??
              null,
            riderEmail:
              booking.riderEmail ??
              ride.rider?.email ??
              null,
          },
          ride: {
            id: ride.id,
            status: ride.status,
            originCity: ride.originCity,
            destinationCity: ride.destinationCity,
            departureTime:
              ride.departureTime.toISOString(),
            tripStartedAt:
              ride.tripStartedAt?.toISOString() ?? null,
            tripCompletedAt:
              ride.tripCompletedAt?.toISOString() ?? null,
            passengerCount: ride.passengerCount,
            distanceMiles: ride.distanceMiles,
            driver: ride.driver
              ? {
                  id: ride.driver.id,
                  name: ride.driver.name,
                  email: ride.driver.email,
                }
              : null,
          },
          money: {
            baseFareCents,
            tipCents,
            discountCents,
            convenienceFeeCents,
            totalChargedCents,
          },
          payment: latestRidePayment
            ? {
                id: latestRidePayment.id,
                status: latestRidePayment.status,
                paymentType: paymentLabel(
                  latestRidePayment.paymentType
                ),
                capturedAt:
                  latestRidePayment.capturedAt?.toISOString() ??
                  null,
                tipStatus:
                  latestRidePayment.tipStatus,
                tipPercent:
                  latestRidePayment.tipPercent ?? null,
                tipChargedAt:
                  latestRidePayment.tipChargedAt?.toISOString() ??
                  null,
                tipSkippedAt:
                  latestRidePayment.tipSkippedAt?.toISOString() ??
                  null,
              }
            : null,
          cashFallback: fallbackCharged
            ? {
                cashNotPaidAt:
                  booking.cashNotPaidAt?.toISOString() ??
                  null,
                cashNotPaidReason:
                  booking.cashNotPaidReason ?? null,
                cashNotPaidNote:
                  booking.cashNotPaidNote ?? null,
                cashDiscountRevokedAt:
                  booking.cashDiscountRevokedAt?.toISOString() ??
                  null,
                cashDiscountRevokedReason:
                  booking.cashDiscountRevokedReason ?? null,
                fallbackCardChargedAt:
                  booking.fallbackCardChargedAt?.toISOString() ??
                  null,
              }
            : null,
          flags: {
            fallbackCharged,
            originallyCash,
          },
        },
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (err) {
    console.error("[mobile/receipt] error:", err);

    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}