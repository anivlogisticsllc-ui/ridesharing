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
  | { ok: true; method: "CARD"; stripeStatus?: string }
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
   * Optional: driver can report "not paid" (if CASH fallback is required and rider refuses).
   * Add this to UI later if you want.
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

function computeReceipt(baseCents: number, cashDiscountBps: number) {
  const base = Math.max(0, Math.round(baseCents));
  const bps = Number.isFinite(cashDiscountBps)
    ? Math.min(5000, Math.max(0, Math.round(cashDiscountBps)))
    : 0;

  const discountCents = bps > 0 ? Math.round(base * (bps / 10000)) : 0;
  const finalAmountCents = Math.max(0, base - discountCents);

  return { baseAmountCents: base, discountCents, finalAmountCents };
}

/* ---------------- Stripe helpers ---------------- */

async function ensureStripeCustomer(args: { userId: string; email?: string | null; name?: string | null }) {
  const u = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { stripeCustomerId: true },
  });

  if (u?.stripeCustomerId) return u.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: args.email ?? undefined,
    name: args.name ?? undefined,
    metadata: { userId: args.userId },
  });

  await prisma.user.update({
    where: { id: args.userId },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

async function chargeCardAtCompletion(args: {
  bookingId: string;
  rideId: string;
  riderId: string;
  riderEmail?: string | null;
  riderName?: string | null;
  amountCents: number;
}) {
  if (!Number.isFinite(args.amountCents) || args.amountCents < 50) {
    return { ok: false as const, stripeStatus: "invalid_amount", error: "Invalid final fare amount." };
  }

  const stripeCustomerId = await ensureStripeCustomer({
    userId: args.riderId,
    email: args.riderEmail,
    name: args.riderName,
  });

  // Prevent double-charging on retries
  const idempotencyKey = `ride-charge:${args.rideId}:${args.amountCents}`;

  const rp = await prisma.ridePayment.upsert({
    where: { idempotencyKey },
    create: {
      rideId: args.rideId,
      riderId: args.riderId,
      amountCents: args.amountCents,
      currency: "usd",
      status: RidePaymentStatus.PENDING,
      provider: "STRIPE",
      paymentType: PaymentType.CARD,
      baseAmountCents: args.amountCents,
      discountCents: 0,
      finalAmountCents: args.amountCents,
      idempotencyKey,
      stripeCustomerId,
    },
    update: {
      amountCents: args.amountCents,
      currency: "usd",
      status: RidePaymentStatus.PENDING,
      paymentType: PaymentType.CARD,
      baseAmountCents: args.amountCents,
      discountCents: 0,
      finalAmountCents: args.amountCents,
      stripeCustomerId,
    },
  });

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: args.amountCents,
        currency: "usd",
        customer: stripeCustomerId,
        confirm: true,
        metadata: {
          bookingId: args.bookingId,
          rideId: args.rideId,
          riderId: args.riderId,
          ridePaymentId: rp.id,
        },
      },
      { idempotencyKey }
    );

    const succeeded = pi.status === "succeeded";

    await prisma.ridePayment.update({
      where: { id: rp.id },
      data: {
        stripePaymentIntentId: pi.id,
        status: succeeded ? RidePaymentStatus.SUCCEEDED : RidePaymentStatus.PENDING,
        capturedAt: succeeded ? new Date() : null,
      },
    });

    if (!succeeded) {
      return { ok: false as const, stripeStatus: pi.status, error: `Stripe did not succeed (status: ${pi.status}).` };
    }

    return { ok: true as const, stripeStatus: pi.status };
  } catch (e: any) {
    await prisma.ridePayment.update({
      where: { id: rp.id },
      data: { status: RidePaymentStatus.FAILED, failedAt: new Date() },
    });

    const msg = e?.message ? String(e.message) : String(e);
    const stripeStatus = e?.raw?.payment_intent?.status || e?.code || e?.type || "failed";
    return { ok: false as const, stripeStatus, error: msg };
  }
}

/* ---------------- Unpaid fallback (stub) ---------------- */
/**
 * Your proposed policy:
 * - If card failed -> rider must pay CASH (no discount)
 * - If rider refuses/doesn’t have CASH -> create balance due: fare + convenience fee
 * - Lock booking until paid
 * - Convenience fee: 10% of fare, min $2, max $10 (goes to driver)
 *
 * We cannot implement the DB writes without a schema (OutstandingCharge / RiderBalance / Lock flag).
 * This stub keeps the endpoint clean and safe today.
 */
function computeConvenienceFeeCents(fareCents: number) {
  const tenPct = Math.round(fareCents * 0.1);
  return Math.max(200, Math.min(1000, tenPct)); // min $2, max $10
}

async function createUnpaidBalanceStub(_args: {
  riderId: string;
  driverId: string;
  rideId: string;
  bookingId: string;
  fareCents: number;
}) {
  const feeCents = computeConvenienceFeeCents(_args.fareCents);
  // TODO: create balance row, lock rider, credit driver fee
  return { feeCents };
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
    if (user.role !== UserRole.DRIVER) return res.status(403).json({ ok: false, error: "Only drivers can complete rides." });

    const driverId = String(user.id);

    // Verification gate
    const profile = await prisma.driverProfile.findUnique({
      where: { userId: driverId },
      select: { verificationStatus: true },
    });
    if (!profile) return res.status(403).json({ ok: false, error: "Driver profile missing. Complete driver setup first." });
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

    if (ride.status === RideStatus.COMPLETED) {
      return res.status(200).json({ ok: true }); // idempotent
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

    // Resolve final fare
    const fareFromBody = clampInt(body.fareCents);
    const fareFromRide = clampInt((ride as any).totalPriceCents);
    const finalFareCents = (fareFromBody && fareFromBody >= 50) ? fareFromBody : (fareFromRide && fareFromRide >= 50) ? fareFromRide : null;

    if (!finalFareCents) return res.status(400).json({ ok: false, error: "Missing final fare amount." });

    const completionTime = new Date();

    // 1) Complete ride + booking (transaction)
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

    // 2) Payment logic
    const paymentType = booking.paymentType ?? PaymentType.CARD;

    // If driver explicitly reports unpaid (future UI), create balance and return
    if (body.unpaid === true) {
      await createUnpaidBalanceStub({
        riderId,
        driverId,
        rideId: ride.id,
        bookingId: booking.id,
        fareCents: finalFareCents,
      });

      // Force CASH, no discount (server truth)
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
          error: "Rider did not pay. Balance due created; rider is blocked until paid.",
        },
      });
    }

    // CASH path: just record receipt based on your existing selection (discount handled earlier when creating booking)
    if (paymentType === PaymentType.CASH) {
      return res.status(200).json({ ok: true, payment: { ok: true, method: "CASH" } });
    }

    // CARD path: attempt charge at completion
    const cardResult = await chargeCardAtCompletion({
      bookingId: booking.id,
      rideId: ride.id,
      riderId,
      riderEmail: booking.riderEmail ?? booking.rider?.email ?? null,
      riderName: booking.riderName ?? booking.rider?.name ?? null,
      amountCents: finalFareCents,
    });

    if (cardResult.ok) {
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
        payment: { ok: true, method: "CARD", stripeStatus: cardResult.stripeStatus },
      });
    }

    // Card failed: force CASH fallback with NO DISCOUNT
    // (your rule: if forced to pay CASH due to card failure, no cash discount)
    const cashNoDiscountReceipt = computeReceipt(finalFareCents, 0);
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        paymentType: PaymentType.CASH,
        cashDiscountBps: 0,
        currency: "USD",
        baseAmountCents: cashNoDiscountReceipt.baseAmountCents,
        discountCents: cashNoDiscountReceipt.discountCents,
        finalAmountCents: cashNoDiscountReceipt.finalAmountCents,
      },
    });

    return res.status(200).json({
      ok: true,
      payment: {
        ok: false,
        method: "CASH",
        stripeStatus: cardResult.stripeStatus,
        error: cardResult.error || "Card charge failed; rider must pay cash (no discount).",
      },
    });
  } catch (err) {
    const msg = asMessage(err);
    console.error("Error completing ride:", err);
    return res.status(500).json({ ok: false, error: msg || "Failed to complete ride." });
  }
}
