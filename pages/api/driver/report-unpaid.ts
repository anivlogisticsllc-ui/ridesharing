// pages/api/driver/report-unpaid.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { BookingStatus, PaymentType, RideStatus, UserRole } from "@prisma/client";
import { guardMembership } from "@/lib/guardMembership";
import { stripe } from "@/lib/stripe";

type ApiResponse =
  | { ok: true; paymentIntentId: string; chargedCents: number; currency: string }
  | { ok: false; error: string };

type Body = {
  rideId?: string;
  reason?: "RIDER_REFUSED_CASH" | "RIDER_NO_CASH" | "OTHER";
  note?: string;
};

const REPORT_WINDOW_MS = 10 * 60 * 1000;

function asMessage(err: unknown) {
  return err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
}

function isValidReason(v: unknown): v is NonNullable<Body["reason"]> {
  return v === "RIDER_REFUSED_CASH" || v === "RIDER_NO_CASH" || v === "OTHER";
}

function clampCents(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const user = session?.user as any;

    if (!user?.id) return res.status(401).json({ ok: false, error: "Not authenticated" });
    if (user.role !== UserRole.DRIVER) return res.status(403).json({ ok: false, error: "Only drivers can report unpaid rides." });

    const driverId = String(user.id);

    const gate = await guardMembership({ userId: driverId, role: UserRole.DRIVER, allowTrial: true });
    if (!gate.ok) return res.status(403).json({ ok: false, error: gate.error || "Membership required." });

    const body = (req.body ?? {}) as Body;

    const rideId = typeof body.rideId === "string" ? body.rideId.trim() : "";
    if (!rideId) return res.status(400).json({ ok: false, error: "rideId is required" });

    if (!isValidReason(body.reason)) return res.status(400).json({ ok: false, error: "reason is required" });

    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
    const reason = body.reason;

    const ride = await prisma.ride.findFirst({
      where: { id: rideId, driverId },
      select: {
        id: true,
        status: true,
        tripCompletedAt: true,
        totalPriceCents: true,
        rider: {
          select: {
            id: true,
            stripeCustomerId: true,
            stripeDefaultPaymentId: true,
          },
        },
        bookings: {
          where: { status: { in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED] } },
          take: 1,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            riderId: true,
            paymentType: true,
            baseAmountCents: true,
          },
        },
      },
    });

    if (!ride) return res.status(404).json({ ok: false, error: "Ride not found for this driver." });
    if (ride.status !== RideStatus.COMPLETED) return res.status(400).json({ ok: false, error: "Ride must be COMPLETED." });
    if (!ride.tripCompletedAt) return res.status(400).json({ ok: false, error: "Ride missing tripCompletedAt." });

    const completedMs = new Date(ride.tripCompletedAt).getTime();
    if (!Number.isFinite(completedMs)) return res.status(400).json({ ok: false, error: "Invalid tripCompletedAt." });

    const ageMs = Date.now() - completedMs;
    if (ageMs < 0 || ageMs > REPORT_WINDOW_MS) {
      return res.status(400).json({ ok: false, error: "Unpaid can only be reported within 10 minutes of completion." });
    }

    const booking = ride.bookings[0] ?? null;
    if (!booking?.id || !booking.riderId) return res.status(400).json({ ok: false, error: "Booking/rider not found." });

    if ((booking.paymentType ?? PaymentType.CARD) !== PaymentType.CASH) {
      return res.status(400).json({ ok: false, error: "Unpaid report is only valid for CASH rides." });
    }

    // Charge baseline = NON-discounted base fare
    const fareBaseline = clampCents(booking.baseAmountCents) ?? clampCents(ride.totalPriceCents) ?? 0;
    const chargeCents = Math.max(0, Math.round(fareBaseline));
    if (chargeCents < 50) return res.status(400).json({ ok: false, error: "Missing/invalid fare amount." });

    const rider = ride.rider;
    if (!rider?.id) return res.status(400).json({ ok: false, error: "Missing rider on ride." });

    const customerId = rider.stripeCustomerId ?? null;
    if (!customerId) {
      return res.status(409).json({ ok: false, error: "Rider has no backup card on file. Cannot charge." });
    }

    // Resolve default PM
    let defaultPm: string | null = rider.stripeDefaultPaymentId ?? null;

    if (!defaultPm) {
      const customer = await stripe.customers.retrieve(customerId);
      if (!customer || (customer as any).deleted) return res.status(409).json({ ok: false, error: "Billing customer missing." });
      defaultPm = (customer as any)?.invoice_settings?.default_payment_method ?? null;
    }

    if (!defaultPm) return res.status(409).json({ ok: false, error: "Rider has no default payment method. Cannot charge." });

    const now = new Date();

    // Stripe charge
    let piId = "";
    let piStatus = "";
    try {
      const pi = await stripe.paymentIntents.create({
        amount: chargeCents,
        currency: "usd",
        customer: customerId,
        payment_method: defaultPm,
        off_session: true,
        confirm: true,
        description: "Unpaid cash ride (backup card charge)",
        metadata: {
          rideId: ride.id,
          bookingId: booking.id,
          driverId,
          reason,
          note: note ?? "",
        },
      });
      piId = pi.id;
      piStatus = String(pi.status ?? "");
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : "Card charge failed.";
      return res.status(402).json({ ok: false, error: msg });
    }

    // ✅ Update booking with full audit trail
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        // keep original intent unchanged
        // originalPaymentType / originalCashDiscountBps should remain as-is

        cashNotPaidAt: now,
        cashNotPaidByUserId: driverId,           // legacy field you already display
        cashNotPaidNote: note || null,           // NEW
        cashNotPaidReportedById: driverId,       // NEW (for richer UI)

        cashDiscountRevokedAt: now,
        cashDiscountRevokedReason: `Driver reported unpaid cash (${reason})`,

        fallbackCardChargedAt: now,

        stripePaymentIntentId: piId,
        stripePaymentIntentStatus: piStatus || "unknown",

        // Final state: CARD and no discount
        paymentType: PaymentType.CARD,
        cashDiscountBps: 0,
        discountCents: 0,
        baseAmountCents: chargeCents,
        finalAmountCents: chargeCents,
      },
    });

    return res.status(200).json({ ok: true, paymentIntentId: piId, chargedCents: chargeCents, currency: "usd" });
  } catch (err) {
    console.error("[driver/report-unpaid] error:", err);
    return res.status(500).json({ ok: false, error: asMessage(err) });
  }
}