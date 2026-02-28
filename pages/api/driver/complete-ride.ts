// pages/api/driver/complete-ride.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import {
  RideStatus,
  BookingStatus,
  UserRole,
  PaymentType,
  RidePaymentStatus,
} from "@prisma/client";
import { guardMembership } from "@/lib/guardMembership";
import { computeDistanceMiles } from "@/lib/distance";
import { stripe } from "@/lib/stripe";

/* ---------------- Types ---------------- */

type PaymentResult =
  | { ok: true; method: "CARD"; stripeStatus?: string; capturedAmountCents?: number }
  | { ok: true; method: "CASH" }
  | { ok: false; method: "CASH"; stripeStatus?: string; error: string };

type ApiResponse =
  | { ok: true; payment?: PaymentResult }
  | { ok: false; error: string };

type CompleteRideBody = {
  rideId?: string;
  elapsedSeconds?: number | null;
  distanceMiles?: number | null;
  fareCents?: number | null;

  /**
   * Optional: driver can report "not paid" (CASH ride where rider refused).
   * In your system this should result in creating an OutstandingCharge elsewhere.
   */
  unpaid?: boolean;
};

function asMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown error";
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function clampInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

/* ---------------- Receipt helpers ---------------- */

function clampCashDiscountBps(bps: unknown) {
  if (typeof bps !== "number" || !Number.isFinite(bps)) return 0;
  return Math.min(5000, Math.max(0, Math.round(bps)));
}

/**
 * Returns a booking snapshot (base/discount/final) consistent with your model:
 * - baseAmountCents: before discount
 * - discountCents: discount amount
 * - finalAmountCents: base - discount (no fee here)
 */
function computeReceipt(baseCents: number, cashDiscountBps: number) {
  const base = Math.max(0, Math.round(baseCents));
  const bps = clampCashDiscountBps(cashDiscountBps);

  const discountCents = bps > 0 ? Math.round(base * (bps / 10000)) : 0;
  const finalAmountCents = Math.max(0, base - discountCents);

  return { baseAmountCents: base, discountCents, finalAmountCents };
}

/* ---------------- Stripe capture helper ---------------- */

async function captureAuthorizedPayment(args: {
  rideId: string;
  driverId: string;
  amountToCaptureCents: number;
}) {
  const amountToCapture = Math.round(args.amountToCaptureCents);

  if (!Number.isFinite(amountToCapture) || amountToCapture < 50) {
    return { ok: false as const, stripeStatus: "invalid_amount", error: "Invalid capture amount." };
  }

  // Latest uncaptured authorization for this ride
  const rp = await prisma.ridePayment.findFirst({
    where: {
      rideId: args.rideId,
      stripePaymentIntentId: { not: null },
      capturedAt: null,
      status: { in: [RidePaymentStatus.AUTHORIZED, RidePaymentStatus.PENDING] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      stripePaymentIntentId: true,
      amountCents: true, // authorized amount (with buffer)
    },
  });

  if (!rp?.stripePaymentIntentId) {
    return {
      ok: false as const,
      stripeStatus: "missing_authorization",
      error: "No authorized payment found for this ride.",
    };
  }

  if (amountToCapture > rp.amountCents) {
    return {
      ok: false as const,
      stripeStatus: "exceeds_authorized",
      error: "Final fare exceeds authorized amount. Increase buffer or re-authorize.",
    };
  }

  try {
    const pi = await stripe.paymentIntents.capture(rp.stripePaymentIntentId, {
      amount_to_capture: amountToCapture,
    });

    const succeeded = pi.status === "succeeded";

    await prisma.ridePayment.update({
      where: { id: rp.id },
      data: {
        status: succeeded ? RidePaymentStatus.SUCCEEDED : RidePaymentStatus.PENDING,
        capturedAt: succeeded ? new Date() : null,
        finalAmountCents: amountToCapture, // store the actual captured amount
      } as any,
    });

    if (!succeeded) {
      return {
        ok: false as const,
        stripeStatus: pi.status,
        error: `Stripe capture did not succeed (status: ${pi.status}).`,
      };
    }

    return {
      ok: true as const,
      stripeStatus: pi.status,
      capturedAmountCents: amountToCapture,
    };
  } catch (e: any) {
    await prisma.ridePayment.updateMany({
      where: { rideId: args.rideId, capturedAt: null },
      data: { status: RidePaymentStatus.FAILED, failedAt: new Date() } as any,
    });

    const msg = e?.message ? String(e.message) : String(e);
    const stripeStatus =
      e?.raw?.payment_intent?.status || e?.code || e?.type || "failed";

    return { ok: false as const, stripeStatus, error: msg };
  }
}

/* ---------------- Handler ---------------- */

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const user = session?.user as any;

    if (!user?.id) return res.status(401).json({ ok: false, error: "Not authenticated" });
    if (user.role !== UserRole.DRIVER) {
      return res.status(403).json({ ok: false, error: "Only drivers can complete rides." });
    }

    const driverId = String(user.id);

    // Verification gate
    const profile = await prisma.driverProfile.findUnique({
      where: { userId: driverId },
      select: { verificationStatus: true },
    });
    if (!profile) {
      return res.status(403).json({ ok: false, error: "Driver profile missing. Complete driver setup first." });
    }
    if (profile.verificationStatus !== "APPROVED") {
      return res.status(403).json({ ok: false, error: `Driver verification required. Status: ${profile.verificationStatus}` });
    }

    // Membership gate
    const gate = await guardMembership({ userId: driverId, role: UserRole.DRIVER, allowTrial: true });
    if (!gate.ok) return res.status(403).json({ ok: false, error: gate.error || "Membership required." });

    const body = (req.body ?? {}) as CompleteRideBody;
    const rideId = typeof body.rideId === "string" ? body.rideId.trim() : "";
    if (!rideId) return res.status(400).json({ ok: false, error: "rideId is required" });

    const ride = await prisma.ride.findFirst({
      where: { id: rideId, driverId },
      include: {
        bookings: {
          where: { status: { in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED] } },
          take: 1,
          include: { rider: true },
        },
      },
    });

    if (!ride) return res.status(404).json({ ok: false, error: "Ride not found for this driver." });

    // Idempotent: if already completed, return success (don’t double-capture)
    if (ride.status === RideStatus.COMPLETED) {
      return res.status(200).json({ ok: true });
    }

    if (ride.status !== RideStatus.ACCEPTED && ride.status !== RideStatus.IN_ROUTE) {
      return res.status(400).json({
        ok: false,
        error: `Ride must be in ACCEPTED or IN_ROUTE to complete (current: ${ride.status}).`,
      });
    }

    const booking = ride.bookings[0] ?? null;
    if (!booking) return res.status(400).json({ ok: false, error: "No booking found for this ride." });

    const riderId = booking.riderId ? String(booking.riderId) : "";
    if (!riderId) return res.status(400).json({ ok: false, error: "Missing riderId on booking." });

    // Resolve final distance
    let finalDistanceMiles: number | null = null;
    if (isPositiveNumber(body.distanceMiles)) finalDistanceMiles = body.distanceMiles;
    else if (isPositiveNumber((ride as any).distanceMiles)) finalDistanceMiles = (ride as any).distanceMiles;
    else if (
      (ride as any).originLat != null &&
      (ride as any).originLng != null &&
      (ride as any).destinationLat != null &&
      (ride as any).destinationLng != null
    ) {
      finalDistanceMiles = computeDistanceMiles(
        (ride as any).originLat,
        (ride as any).originLng,
        (ride as any).destinationLat,
        (ride as any).destinationLng
      );
    }

    // Resolve final fare (cents)
    const fareFromBody = clampInt(body.fareCents);
    const fareFromRide = clampInt((ride as any).totalPriceCents);
    const finalFareCents =
      (fareFromBody && fareFromBody >= 50) ? fareFromBody :
      (fareFromRide && fareFromRide >= 50) ? fareFromRide :
      null;

    if (!finalFareCents) return res.status(400).json({ ok: false, error: "Missing final fare amount." });

    const completionTime = new Date();

    // 1) Complete ride + booking
    await prisma.$transaction(async (tx) => {
      await tx.ride.update({
        where: { id: ride.id },
        data: {
          status: RideStatus.COMPLETED,
          tripCompletedAt: completionTime,
          distanceMiles: finalDistanceMiles ?? undefined,
          totalPriceCents: finalFareCents,
        },
      });

      await tx.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.COMPLETED },
      });
    });

    // 2) Payment behavior
    const paymentType = booking.paymentType ?? PaymentType.CARD;

    // If driver explicitly reports unpaid: treat as CASH unpaid event (no Stripe here)
    // You’ll wire this to your OutstandingCharge creation endpoint from UI.
    if (body.unpaid === true) {
      // Force CASH, remove discount (revert cash promo for conflict scenario)
      const receipt = computeReceipt(finalFareCents, 0);

      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          paymentType: PaymentType.CASH,
          cashDiscountBps: 0,
          currency: "USD",
          baseAmountCents: receipt.baseAmountCents,
          discountCents: receipt.discountCents,
          finalAmountCents: receipt.finalAmountCents,
        },
      });

      return res.status(200).json({
        ok: true,
        payment: {
          ok: false,
          method: "CASH",
          error: "Rider did not pay cash. Create Outstanding Charge and block rider until paid.",
        },
      });
    }

    // CASH: successful cash paid at dropoff -> no Stripe, keep the existing discount that was set at booking time
    if (paymentType === PaymentType.CASH) {
      // Make sure booking receipt is consistent with finalFareCents and its stored cashDiscountBps
      const bps = typeof (booking as any).cashDiscountBps === "number" ? (booking as any).cashDiscountBps : 0;
      const receipt = computeReceipt(finalFareCents, bps);

      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          currency: "USD",
          baseAmountCents: receipt.baseAmountCents,
          discountCents: receipt.discountCents,
          finalAmountCents: receipt.finalAmountCents,
        },
      });

      return res.status(200).json({ ok: true, payment: { ok: true, method: "CASH" } });
    }

    // CARD: capture an existing authorization (manual capture)
    // NOTE: tips are intentionally NOT captured here yet (see note below).
    const capture = await captureAuthorizedPayment({
      rideId: ride.id,
      driverId,
      amountToCaptureCents: finalFareCents,
    });

    if (capture.ok) {
      // Update booking receipt for CARD (no discount)
      const receipt = computeReceipt(finalFareCents, 0);

      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          paymentType: PaymentType.CARD,
          cashDiscountBps: 0,
          currency: "USD",
          baseAmountCents: receipt.baseAmountCents,
          discountCents: receipt.discountCents,
          finalAmountCents: receipt.finalAmountCents,
        },
      });

      return res.status(200).json({
        ok: true,
        payment: {
          ok: true,
          method: "CARD",
          stripeStatus: capture.stripeStatus,
          capturedAmountCents: capture.capturedAmountCents,
        },
      });
    }

    // If CARD capture fails, your policy is: rider must pay CASH, NO DISCOUNT
    const cashNoDiscount = computeReceipt(finalFareCents, 0);

    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        paymentType: PaymentType.CASH,
        cashDiscountBps: 0,
        currency: "USD",
        baseAmountCents: cashNoDiscount.baseAmountCents,
        discountCents: cashNoDiscount.discountCents,
        finalAmountCents: cashNoDiscount.finalAmountCents,
      },
    });

    return res.status(200).json({
      ok: true,
      payment: {
        ok: false,
        method: "CASH",
        stripeStatus: capture.stripeStatus,
        error: capture.error || "Card capture failed; rider must pay cash (no discount).",
      },
    });
  } catch (err) {
    const msg = asMessage(err);
    console.error("Error completing ride:", err);
    return res.status(500).json({ ok: false, error: msg || "Failed to complete ride." });
  }
}