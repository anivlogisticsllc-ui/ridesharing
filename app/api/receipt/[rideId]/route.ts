// app/api/receipt/[rideId]/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { BookingStatus, RideStatus, PaymentType } from "@prisma/client";

type ReceiptResponse =
  | { ok: true; receipt: any }
  | { ok: false; error: string };

function toStr(v: unknown) {
  return typeof v === "string" ? v : "";
}

function asCents(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null;
}

function paymentLabel(pt: PaymentType | null | undefined): "CARD" | "CASH" | null {
  if (pt === PaymentType.CARD) return "CARD";
  if (pt === PaymentType.CASH) return "CASH";
  return null;
}

export async function GET(_req: Request, { params }: { params: { rideId: string } }) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as any;

    const userId = toStr(user?.id).trim();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Not authenticated" } satisfies ReceiptResponse, { status: 401 });
    }

    // NOTE: your param name is [rideId], but this route is actually keyed by bookingId in the UI.
    const bookingId = toStr(params?.rideId).trim();
    if (!bookingId) {
      return NextResponse.json({ ok: false, error: "Missing bookingId" } satisfies ReceiptResponse, { status: 400 });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        paymentType: true,
        cashDiscountBps: true,
        createdAt: true,

        riderId: true,
        riderName: true,
        riderEmail: true,

        baseAmountCents: true,
        discountCents: true,
        finalAmountCents: true,
        currency: true,

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
            driver: { select: { id: true, name: true, email: true } },
            rider: { select: { id: true, name: true, email: true } },
          },
        },

        outstandingCharge: {
          select: {
            id: true,
            status: true,
            fareCents: true,
            convenienceFeeCents: true,
            totalCents: true,
            currency: true,
            createdAt: true,
            paidAt: true,
            disputedAt: true,
            resolvedAt: true,
            reason: true,
            note: true,
          },
        },
      },
    });

    if (!booking?.ride) {
      return NextResponse.json({ ok: false, error: "Receipt not found" } satisfies ReceiptResponse, { status: 404 });
    }

    const ride = booking.ride;

    // Receipt only after ride completed (your existing behavior)
    if (ride.status !== RideStatus.COMPLETED) {
      return NextResponse.json(
        { ok: false, error: "Receipt is only available for completed rides." } satisfies ReceiptResponse,
        { status: 400 }
      );
    }

    // Allow rider on booking OR driver on ride
    const isDriver = ride.driverId === userId;
    const isRider = booking.riderId === userId || ride.rider?.id === userId;

    if (!isDriver && !isRider) {
      return NextResponse.json({ ok: false, error: "Not allowed" } satisfies ReceiptResponse, { status: 403 });
    }

    // ---- Amount logic ----
    // If OutstandingCharge exists, it is the truth for fee + total for the "unpaid cash ride" scenario.
    const oc = booking.outstandingCharge;

    const fareCents =
      oc?.fareCents ??
      asCents(booking.baseAmountCents) ??
      asCents(booking.finalAmountCents) ??
      asCents(ride.totalPriceCents) ??
      0;

    const convenienceFeeCents =
      oc?.convenienceFeeCents ??
      0;

    const totalCents =
      oc?.totalCents ??
      asCents(booking.finalAmountCents) ??
      // if we only have base fare, total is base - discount (no fee in normal receipts)
      Math.max(0, fareCents - (asCents(booking.discountCents) ?? 0)) ??
      0;

    const receipt = {
      booking: {
        id: booking.id,
        status: booking.status,
        createdAt: booking.createdAt,
        paymentType: paymentLabel(booking.paymentType),
        cashDiscountBps: booking.cashDiscountBps ?? 0,
        currency: (booking.currency || "USD").toUpperCase(),

        riderId: booking.riderId,
        riderName: booking.riderName ?? booking.ride.rider?.name ?? null,
        riderEmail: booking.riderEmail ?? booking.ride.rider?.email ?? null,
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
        driver: ride.driver ? { name: ride.driver.name, email: ride.driver.email } : null,
      },

      // The UI should render from these three for the breakdown
      money: {
        baseFareCents: fareCents,
        discountCents: oc ? 0 : (asCents(booking.discountCents) ?? 0),
        convenienceFeeCents,
        totalPriceCents: totalCents,
        // helpful for UI to decide what mode it is
        source: oc ? "OUTSTANDING_CHARGE" : "BOOKING",
      },

      outstandingCharge: oc
        ? {
            id: oc.id,
            status: oc.status,
            fareCents: oc.fareCents,
            convenienceFeeCents: oc.convenienceFeeCents,
            totalCents: oc.totalCents,
            currency: (oc.currency || booking.currency || "USD").toUpperCase(),
            reason: oc.reason,
            note: oc.note,
            createdAt: oc.createdAt,
            paidAt: oc.paidAt,
            disputedAt: oc.disputedAt,
            resolvedAt: oc.resolvedAt,
          }
        : null,
    };

    return NextResponse.json({ ok: true, receipt } satisfies ReceiptResponse, { status: 200 });
  } catch (err) {
    console.error("[api/receipt/[id]] error:", err);
    return NextResponse.json({ ok: false, error: "Server error" } satisfies ReceiptResponse, { status: 500 });
  }
}