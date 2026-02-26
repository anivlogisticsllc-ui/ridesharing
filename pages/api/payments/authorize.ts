// pages/api/payments/authorize.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { stripe } from "../../../lib/stripe";
import { PaymentType, RideStatus, RidePaymentStatus } from "@prisma/client";

type ApiResponse =
  | { ok: true; paymentIntentId: string }
  | { ok: false; error: string };

function safeInt(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const session = await getServerSession(req, res, authOptions);
    const user = session?.user as any;
    if (!user?.id) return res.status(401).json({ ok: false, error: "Not authenticated" });

    const bookingId = String(req.body?.bookingId ?? "").trim();
    if (!bookingId) return res.status(400).json({ ok: false, error: "bookingId is required" });

    // booking.id is unique
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { ride: true, rider: true },
    });

    if (!booking || booking.riderId !== user.id || !booking.ride) {
      return res.status(404).json({ ok: false, error: "Booking/ride not found" });
    }

    // Payment action should be locked after trip start
    const started =
      !!booking.ride.tripStartedAt || booking.ride.status === RideStatus.IN_ROUTE;

    if (started) {
      return res.status(409).json({
        ok: false,
        error: "Payment can’t be authorized after the trip has started.",
      });
    }

    // CASH should never hit Stripe
    if (booking.paymentType === PaymentType.CASH) {
      return res.status(400).json({
        ok: false,
        error: "Cash bookings do not require card authorization.",
      });
    }

    // Prefer booking snapshot fields (these already include discounts)
    const baseAmountCents = safeInt((booking as any).baseAmountCents) || safeInt(booking.ride.totalPriceCents);
    const discountCents = safeInt((booking as any).discountCents);
    const finalAmountCents = safeInt((booking as any).finalAmountCents) || Math.max(0, baseAmountCents - discountCents);

    const amountCents = finalAmountCents;
    if (amountCents <= 0) return res.status(400).json({ ok: false, error: "Invalid fare amount" });

    // Ensure Stripe customer
    let stripeCustomerId = booking.rider?.stripeCustomerId ?? null;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: booking.rider?.email ?? undefined,
        name: booking.rider?.name ?? undefined,
        metadata: { userId: user.id },
      });

      stripeCustomerId = customer.id;

      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId },
      });
    }

    const rideId = booking.ride.id;
    const riderId = user.id;

    // Use your model's unique idempotencyKey
    const idempotencyKey = `authorize:${bookingId}:${amountCents}`;

    // Create or update RidePayment using idempotencyKey (unique)
    // NOTE: adjust enum values if your RidePaymentStatus uses different names.
    const payment = await prisma.ridePayment.upsert({
      where: { idempotencyKey },
      create: {
        rideId,
        riderId,
        amountCents,
        currency: "usd",
        status: RidePaymentStatus.AUTHORIZED, // if this errors, change to a valid enum value (ex: PENDING)
        provider: "STRIPE",
        paymentType: PaymentType.CARD,
        baseAmountCents,
        discountCents,
        finalAmountCents,
        idempotencyKey,
        stripeCustomerId,
        authorizedAt: new Date(),
      },
      update: {
        amountCents,
        currency: "usd",
        status: RidePaymentStatus.AUTHORIZED, // same note as above
        paymentType: PaymentType.CARD,
        baseAmountCents,
        discountCents,
        finalAmountCents,
        stripeCustomerId,
        authorizedAt: new Date(),
      },
    });

    // Create PI (manual capture)
    const pi = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        customer: stripeCustomerId,
        capture_method: "manual",
        metadata: {
          bookingId,
          rideId,
          riderId,
          ridePaymentId: payment.id,
        },
      },
      { idempotencyKey }
    );

    await prisma.ridePayment.update({
      where: { id: payment.id },
      data: {
        stripePaymentIntentId: pi.id,
        // Keep status as AUTHORIZED, or move to another enum like PI_CREATED if you have it
        status: RidePaymentStatus.AUTHORIZED,
      },
    });

    return res.status(200).json({ ok: true, paymentIntentId: pi.id });
  } catch (err) {
    console.error("[api/payments/authorize] error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}
