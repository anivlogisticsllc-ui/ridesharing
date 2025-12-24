// pages/api/payments/authorize.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { stripe } from "../../../lib/stripe";

type ApiResponse = { ok: true; paymentIntentId: string } | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const user = session?.user as any;
  if (!user?.id) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const bookingId = String(req.body?.bookingId ?? "").trim();
  if (!bookingId) return res.status(400).json({ ok: false, error: "bookingId is required" });

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, riderId: user.id },
    include: { ride: true, rider: true },
  });

  if (!booking?.ride) return res.status(404).json({ ok: false, error: "Booking/ride not found" });

  const amountCents = booking.ride.totalPriceCents ?? 0;
  if (amountCents <= 0) return res.status(400).json({ ok: false, error: "Invalid fare amount" });

  // ensure Stripe customer
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

  // Create or reuse RidePayment row
  const payment = await prisma.ridePayment.upsert({
    where: { bookingId },
    create: {
      bookingId,
      riderId: user.id,
      amountCents,
      currency: "usd",
      status: "CREATED",
    },
    update: {
      amountCents,
      currency: "usd",
    },
  });

  // Create PI (manual capture)
  const pi = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    customer: stripeCustomerId,
    capture_method: "manual",
    // IMPORTANT: for now we’re not confirming here because you may not have a saved PM yet.
    // We'll add "confirm" and "payment_method" once you add card collection.
    metadata: {
      bookingId,
      riderId: user.id,
      rideId: booking.ride.id,
      ridePaymentId: payment.id,
    },
  });

  await prisma.ridePayment.update({
    where: { id: payment.id },
    data: {
      stripePaymentIntentId: pi.id,
      status: "AUTHORIZED", // logically "created" but we treat it as reserved/authorized path
    },
  });

  return res.status(200).json({ ok: true, paymentIntentId: pi.id });
}
