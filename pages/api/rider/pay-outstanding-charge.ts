// pages/api/rider/pay-outstanding-charge.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { UserRole } from "@prisma/client";

type ApiResponse =
  | { ok: true; stripeStatus: string }
  | { ok: false; error: string };

type Body = { outstandingChargeId?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const user = session?.user as any;

    if (!user?.id) return res.status(401).json({ ok: false, error: "Not authenticated" });
    if (user.role !== UserRole.RIDER) return res.status(403).json({ ok: false, error: "Only riders." });

    const riderId = String(user.id);
    const body = (req.body ?? {}) as Body;
    const id = typeof body.outstandingChargeId === "string" ? body.outstandingChargeId.trim() : "";
    if (!id) return res.status(400).json({ ok: false, error: "outstandingChargeId is required" });

    const charge = await prisma.outstandingCharge.findFirst({
      where: { id, riderId, status: "OPEN" },
      select: {
        id: true,
        totalCents: true,
        currency: true,
        stripePaymentIntentId: true,
        bookingId: true,
        rideId: true,
      },
    });

    if (!charge) return res.status(404).json({ ok: false, error: "Outstanding charge not found." });
    if (charge.totalCents < 50) return res.status(400).json({ ok: false, error: "Invalid amount." });

    // Ensure Stripe customer exists (must have default PM to confirm)
    const u = await prisma.user.findUnique({
      where: { id: riderId },
      select: { stripeCustomerId: true, email: true, name: true },
    });

    if (!u) return res.status(404).json({ ok: false, error: "User not found." });

    let stripeCustomerId = u.stripeCustomerId ?? null;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: u.email ?? undefined,
        name: u.name ?? undefined,
        metadata: { userId: riderId },
      });
      stripeCustomerId = customer.id;
      await prisma.user.update({ where: { id: riderId }, data: { stripeCustomerId } });
    }

    const idempotencyKey = `pay-oc:${charge.id}:${charge.totalCents}`;

    const pi = await stripe.paymentIntents.create(
      {
        amount: charge.totalCents,
        currency: "usd",
        customer: stripeCustomerId,
        confirm: true,
        metadata: {
          outstandingChargeId: charge.id,
          riderId,
          rideId: charge.rideId,
          bookingId: charge.bookingId,
        },
      },
      { idempotencyKey }
    );

    if (pi.status !== "succeeded") {
      return res.status(400).json({ ok: false, error: `Payment not succeeded (status: ${pi.status}).` });
    }

    await prisma.outstandingCharge.update({
      where: { id: charge.id },
      data: {
        status: "PAID",
        stripePaymentIntentId: pi.id,
        paidAt: new Date(),
        resolvedAt: new Date(),
      },
    });

    return res.status(200).json({ ok: true, stripeStatus: pi.status });
  } catch (err: any) {
    console.error("[rider/pay-outstanding-charge] error:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
