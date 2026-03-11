// app/api/receipt/[rideId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { PaymentType, RideStatus } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ReceiptResponse =
  | { ok: true; receipt: unknown }
  | { ok: false; error: string };

function toStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asCents(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.max(0, Math.round(v));
  }

  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
  }

  return null;
}

function paymentLabel(pt: PaymentType | null | undefined): "CARD" | "CASH" | null {
  if (pt === PaymentType.CARD) return "CARD";
  if (pt === PaymentType.CASH) return "CASH";
  return null;
}

// IMPORTANT: your Next types validator expects params to be a Promise
type RouteContext = { params: Promise<{ rideId: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const token = await getToken({ req });
    const userId = toStr((token as { sub?: unknown; id?: unknown } | null)?.sub).trim()
      || toStr((token as { sub?: unknown; id?: unknown } | null)?.id).trim();

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" } satisfies ReceiptResponse,
        { status: 401 }
      );
    }

    const { rideId } = await params;

    // NOTE: route segment is [rideId], but UI is passing bookingId. Keeping behavior as bookingId.
    const bookingId = toStr(rideId).trim();

    if (!bookingId) {
      return NextResponse.json(
        { ok: false, error: "Missing bookingId" } satisfies ReceiptResponse,
        { status: 400 }
      );
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        paymentType: true,
        originalPaymentType: true,
        cashDiscountBps: true,
        originalCashDiscountBps: true,
        createdAt: true,

        riderId: true,
        riderName: true,
        riderEmail: true,

        baseAmountCents: true,
        discountCents: true,
        finalAmountCents: true,
        currency: true,

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
            driver: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            rider: {
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
        { ok: false, error: "Receipt not found" } satisfies ReceiptResponse,
        { status: 404 }
      );
    }

    const ride = booking.ride;

    if (ride.status !== RideStatus.COMPLETED) {
      return NextResponse.json(
        { ok: false, error: "Receipt is only available for completed rides." } satisfies ReceiptResponse,
        { status: 400 }
      );
    }

    const isDriver = ride.driverId === userId;
    const isRider = booking.riderId === userId || ride.rider?.id === userId;

    if (!isDriver && !isRider) {
      return NextResponse.json(
        { ok: false, error: "Not allowed" } satisfies ReceiptResponse,
        { status: 403 }
      );
    }

    const fallbackCharged = Boolean(booking.cashNotPaidAt && booking.fallbackCardChargedAt);

    const baseFareCents =
      asCents(booking.baseAmountCents) ??
      asCents(booking.finalAmountCents) ??
      asCents(ride.totalPriceCents) ??
      0;

    const discountCents = fallbackCharged ? 0 : asCents(booking.discountCents) ?? 0;

    const totalCents =
      asCents(booking.finalAmountCents) ??
      Math.max(0, baseFareCents - discountCents);

    const receipt = {
      booking: {
        id: booking.id,
        status: booking.status,
        createdAt: booking.createdAt,

        paymentType: paymentLabel(booking.paymentType),
        originalPaymentType: paymentLabel(booking.originalPaymentType),
        cashDiscountBps: booking.cashDiscountBps ?? 0,
        originalCashDiscountBps: booking.originalCashDiscountBps ?? 0,
        currency: (booking.currency || "USD").toUpperCase(),

        riderId: booking.riderId,
        riderName: booking.riderName ?? ride.rider?.name ?? null,
        riderEmail: booking.riderEmail ?? ride.rider?.email ?? null,
      },

      ride: {
        id: ride.id,
        status: ride.status,
        originCity: ride.originCity,
        destinationCity: ride.destinationCity,
        departureTime: ride.departureTime,
        tripStartedAt: ride.tripStartedAt,
        tripCompletedAt: ride.tripCompletedAt,
        passengerCount: ride.passengerCount,
        distanceMiles: ride.distanceMiles,
        driver: ride.driver
          ? {
              name: ride.driver.name,
              email: ride.driver.email,
            }
          : null,
      },

      money: {
        baseFareCents,
        discountCents,
        convenienceFeeCents: 0,
        totalPriceCents: totalCents,
        source: fallbackCharged ? "BOOKING_FALLBACK_CARD" : "BOOKING",
      },

      cashFallback: fallbackCharged
        ? {
            originalPaymentType: paymentLabel(booking.originalPaymentType),
            currentPaymentType: paymentLabel(booking.paymentType),
            cashNotPaidAt: booking.cashNotPaidAt,
            cashNotPaidByUserId: booking.cashNotPaidByUserId ?? booking.cashNotPaidReportedById ?? null,
            cashNotPaidReportedById: booking.cashNotPaidReportedById ?? null,
            cashNotPaidReason: booking.cashNotPaidReason ?? null,
            cashNotPaidNote: booking.cashNotPaidNote ?? null,
            cashDiscountRevokedAt: booking.cashDiscountRevokedAt,
            cashDiscountRevokedReason: booking.cashDiscountRevokedReason ?? null,
            fallbackCardChargedAt: booking.fallbackCardChargedAt,
            stripePaymentIntentId: booking.stripePaymentIntentId ?? null,
            stripePaymentIntentStatus: booking.stripePaymentIntentStatus ?? null,
          }
        : null,
    };

    return NextResponse.json(
      { ok: true, receipt } satisfies ReceiptResponse,
      { status: 200 }
    );
  } catch (err) {
    console.error("[api/receipt/[rideId]] error:", err);
    return NextResponse.json(
      { ok: false, error: "Server error" } satisfies ReceiptResponse,
      { status: 500 }
    );
  }
}