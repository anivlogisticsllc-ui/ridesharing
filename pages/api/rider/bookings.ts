// pages/api/rider/bookings.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { BookingStatus, PaymentType } from "@prisma/client";

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
    // --- cash override audit (NEW) ---
  originalPaymentType?: PaymentType | null;
  originalCashDiscountBps?: number | null;

  cashNotPaidAt?: string | null;
  cashNotPaidByUserId?: string | null;
  cashDiscountRevokedAt?: string | null;
  cashDiscountRevokedReason?: string | null;

  fallbackCardChargedAt?: string | null;
};

type ApiResponse =
  | { ok: true; bookings: ApiBooking[] }
  | { ok: false; error: string };

function getSessionUserId(session: unknown): string | null {
  const id = (session as any)?.user?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function toIsoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function cents(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null;
}

function bps(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(10000, Math.max(0, Math.round(v)));
}

function applyCashDiscount(baseCents: number, paymentType: PaymentType | null, cashDiscountBps: number | null): number {
  if (paymentType !== PaymentType.CASH) return baseCents;
  const d = typeof cashDiscountBps === "number" ? cashDiscountBps : 0;
  const multiplier = (10000 - d) / 10000;
  return Math.round(baseCents * multiplier);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const userId = getSessionUserId(session);

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
            totalPriceCents: true, // legacy estimate
            passengerCount: true,
            tripStartedAt: true,
            tripCompletedAt: true,
            driver: { select: { name: true, publicId: true } },
          },
        },
        conversation: { select: { id: true } },
        outstandingCharge: {
          select: { id: true, totalCents: true },
        },
      },
    });

    const shapedBookings: ApiBooking[] = bookings.map((b) => {
      const baseAmountCents = cents(b.baseAmountCents);
      const discountCents = cents(b.discountCents) ?? 0;
      const finalAmountCents = cents(b.finalAmountCents);
      const rideEstimateCents = cents(b.ride.totalPriceCents);

      const paymentType: PaymentType | null = b.paymentType ?? null;
      const cashDiscountBps = bps(b.cashDiscountBps);

      // Base shown in UI: prefer booking.baseAmountCents, otherwise ride estimate
      const base = baseAmountCents ?? rideEstimateCents;

      // Effective:
      // 1) OutstandingCharge wins (unpaid cash scenario)
      // 2) booking.finalAmountCents if present
      // 3) else compute from base - discount (cash discount applied to base)
      let effective: number | null = null;

      const ocTotal = cents(b.outstandingCharge?.totalCents);
      if (ocTotal != null) {
        effective = ocTotal;
      } else if (finalAmountCents != null) {
        effective = finalAmountCents;
      } else if (base != null) {
        const discountedBase =
          paymentType === PaymentType.CASH
            ? applyCashDiscount(base, paymentType, cashDiscountBps)
            : base;

        effective = Math.max(0, discountedBase - discountCents);
      } else {
        effective = null;
      }

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
        tripStartedAt: toIsoOrNull(b.ride.tripStartedAt),
        tripCompletedAt: toIsoOrNull(b.ride.tripCompletedAt),

        paymentType,
        cashDiscountBps,

        baseTotalPriceCents: base,
        effectiveTotalPriceCents: effective,
        
        originalPaymentType: b.originalPaymentType ?? null,
        originalCashDiscountBps: bps(b.originalCashDiscountBps),

        cashNotPaidAt: toIsoOrNull(b.cashNotPaidAt),
        cashNotPaidByUserId: b.cashNotPaidByUserId ?? null,
        cashDiscountRevokedAt: toIsoOrNull(b.cashDiscountRevokedAt),
        cashDiscountRevokedReason: b.cashDiscountRevokedReason ?? null,

        fallbackCardChargedAt: toIsoOrNull(b.fallbackCardChargedAt),
      };
    });

    const ridesWithoutBookings = await prisma.ride.findMany({
      where: { riderId: userId, bookings: { none: {} } },
      orderBy: { createdAt: "desc" },
      include: { driver: { select: { name: true, publicId: true } } },
    });

    const shapedRideOnly: ApiBooking[] = ridesWithoutBookings.map((r) => {
      const base = cents(r.totalPriceCents);

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
        tripStartedAt: toIsoOrNull(r.tripStartedAt),
        tripCompletedAt: toIsoOrNull(r.tripCompletedAt),

        paymentType: null,
        cashDiscountBps: null,

        baseTotalPriceCents: base,
        effectiveTotalPriceCents: base,
      };
    });

    const combined = [...shapedBookings, ...shapedRideOnly];

    combined.sort((a, b) => {
      const da = Date.parse(a.departureTime);
      const db = Date.parse(b.departureTime);
      return (Number.isNaN(db) ? 0 : db) - (Number.isNaN(da) ? 0 : da);
    });

    return res.status(200).json({ ok: true, bookings: combined });
  } catch (err) {
    console.error("Error loading rider bookings:", err);
    return res.status(500).json({ ok: false, error: "Failed to load bookings" });
  }
}