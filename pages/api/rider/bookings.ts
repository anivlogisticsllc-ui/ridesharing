// pages/api/rider/bookings.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { BookingStatus, PaymentType } from "@prisma/client";

type ApiBooking = {
  // UI id (real booking id OR synthetic "ride-<rideId>")
  id: string;

  // Real Booking row id (null for ride-only entries)
  bookingId: string | null;

  status: BookingStatus;

  rideId: string;
  originCity: string;
  destinationCity: string;
  departureTime: string; // ISO
  rideStatus: string;

  driverName: string | null;
  driverPublicId: string | null;
  conversationId: string | null;

  isRideOnly: boolean;

  distanceMiles?: number | null;
  passengerCount?: number | null;
  tripStartedAt?: string | null;
  tripCompletedAt?: string | null;

  // payment / totals
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

  const bps = Number.isFinite(cashDiscountBps ?? NaN) ? (cashDiscountBps as number) : 0;
  const multiplier = Math.max(0, 10000 - bps) / 10000;
  return Math.round(baseCents * multiplier);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const userId = typeof (session?.user as any)?.id === "string" ? ((session?.user as any).id as string) : undefined;

  if (!userId) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  try {
    // 1) Normal bookings for this rider
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
            driver: { select: { name: true, publicId: true } },
          },
        },
        conversation: { select: { id: true } },
      },
    });

    const shapedBookings: ApiBooking[] = bookings.map((b) => {
      const base = b.ride.totalPriceCents ?? null;
      const effective =
        base == null ? null : applyCashDiscount(base, b.paymentType ?? null, b.cashDiscountBps ?? null);

      return {
        id: b.id,
        bookingId: b.id,

        status: b.status as BookingStatus,

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
        tripStartedAt: b.ride.tripStartedAt ? b.ride.tripStartedAt.toISOString() : null,
        tripCompletedAt: b.ride.tripCompletedAt ? b.ride.tripCompletedAt.toISOString() : null,

        paymentType: b.paymentType ?? null,
        cashDiscountBps: b.cashDiscountBps ?? null,
        baseTotalPriceCents: base,
        effectiveTotalPriceCents: effective,
      };
    });

    // 2) Rides with no booking row (legacy edge case)
    const ridesWithoutBookings = await prisma.ride.findMany({
      where: {
        riderId: userId,
        bookings: { none: {} },
      },
      orderBy: { createdAt: "desc" },
      include: {
        driver: { select: { name: true, publicId: true } },
      },
    });

    const shapedRideOnly: ApiBooking[] = ridesWithoutBookings.map((r) => ({
      id: `ride-${r.id}`,
      bookingId: null,

      // This is intentionally "PENDING" because there's no Booking row yet.
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
      baseTotalPriceCents: r.totalPriceCents,
      effectiveTotalPriceCents: r.totalPriceCents,
    }));

    const combined = [...shapedBookings, ...shapedRideOnly];

    // predictable output ordering
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
