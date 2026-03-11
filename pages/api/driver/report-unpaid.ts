// pages/api/driver/report-unpaid.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import {
  BookingStatus,
  PaymentType,
  RideStatus,
  UserRole,
  NotificationType,
} from "@prisma/client";
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

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function moneyFromCents(cents: number) {
  return (Math.max(0, Math.round(cents)) / 100).toFixed(2);
}

async function createFallbackChargeNotification(args: {
  riderId: string;
  rideId: string;
  bookingId: string;
  driverId: string;
  amountCents: number;
  fallbackChargedAt: Date;
  reason: "RIDER_REFUSED_CASH" | "RIDER_NO_CASH" | "OTHER";
  note?: string;
}) {
  const title = "Cash ride updated to card charge";
  const message = `Your driver reported that cash was not received for this ride. Your backup card was charged $${moneyFromCents(
    args.amountCents
  )}. If this is incorrect, you can dispute the charge.`;

  return prisma.notification.create({
    data: {
      userId: args.riderId,
      rideId: args.rideId,
      bookingId: args.bookingId,
      type: NotificationType.CASH_UNPAID_FALLBACK_CHARGED,
      title,
      message,
      metadata: {
        amountCents: args.amountCents,
        originalPaymentType: "CASH",
        finalPaymentType: "CARD",
        driverId: args.driverId,
        reason: args.reason,
        note: args.note || null,
        fallbackChargedAt: args.fallbackChargedAt.toISOString(),
      },
    },
    select: { id: true },
  });
}

async function sendFallbackChargeAlertEmailSafe(args: {
  riderEmail: string;
  riderName?: string | null;
  driverName?: string | null;
  ride: {
    id: string;
    originCity: string;
    destinationCity: string;
    departureTime: Date | string;
  };
  amountCents: number;
  note?: string | null;
}) {
  try {
    const amount = moneyFromCents(args.amountCents);
    const departure =
      args.ride.departureTime instanceof Date
        ? args.ride.departureTime.toLocaleString()
        : String(args.ride.departureTime);

    const subject = "Cash ride updated to card charge";

    const html = `
      <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:16px;">
        <h2 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Cash ride updated to card charge</h2>

        <p style="margin:0 0 12px;font-size:14px;color:#475569;">
          Hi${args.riderName ? ` ${escapeHtml(args.riderName)}` : ""}, your driver reported that cash was not received for this ride.
        </p>

        <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px;background:#fff;margin-bottom:12px;">
          <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:6px;">
            ${escapeHtml(args.ride.originCity)} → ${escapeHtml(args.ride.destinationCity)}
          </div>
          <div style="font-size:12px;color:#64748b;margin-bottom:10px;">
            Scheduled departure: ${escapeHtml(departure)}
          </div>
          <div style="font-size:14px;color:#0f172a;">
            Your backup card was charged <b>$${escapeHtml(amount)}</b>.
          </div>
          ${
            args.driverName
              ? `<div style="margin-top:8px;font-size:12px;color:#64748b;">Driver: ${escapeHtml(args.driverName)}</div>`
              : ""
          }
          ${
            args.note?.trim()
              ? `<div style="margin-top:8px;font-size:12px;color:#64748b;">Driver note: ${escapeHtml(args.note.trim())}</div>`
              : ""
          }
          <div style="margin-top:8px;font-size:11px;color:#94a3b8;">Ride ID: ${escapeHtml(args.ride.id)}</div>
        </div>

        <p style="margin:0;font-size:12px;color:#64748b;">
          If this is incorrect, you can dispute the charge in your RideShare account.
        </p>
      </div>
    `;

    const text = [
      "Cash ride updated to card charge",
      "",
      args.riderName ? `Hi ${args.riderName},` : "Hello,",
      "",
      "Your driver reported that cash was not received for this ride.",
      `Backup card charged: $${amount}`,
      `Route: ${args.ride.originCity} -> ${args.ride.destinationCity}`,
      `Departure: ${departure}`,
      args.driverName ? `Driver: ${args.driverName}` : "",
      args.note?.trim() ? `Driver note: ${args.note.trim()}` : "",
      `Ride ID: ${args.ride.id}`,
      "",
      "If this is incorrect, you can dispute the charge in your RideShare account.",
    ]
      .filter(Boolean)
      .join("\n");

    await sendEmail({
      to: args.riderEmail,
      subject,
      html,
      text,
    });
  } catch (err) {
    console.error("[fallback-charge-email] failed:", err);
  }
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
    if (user.role !== UserRole.DRIVER) {
      return res.status(403).json({ ok: false, error: "Only drivers can report unpaid rides." });
    }

    const driverId = String(user.id);

    const gate = await guardMembership({
      userId: driverId,
      role: UserRole.DRIVER,
      allowTrial: true,
    });
    if (!gate.ok) {
      return res.status(403).json({ ok: false, error: gate.error || "Membership required." });
    }

    const body = (req.body ?? {}) as Body;

    const rideId = typeof body.rideId === "string" ? body.rideId.trim() : "";
    if (!rideId) return res.status(400).json({ ok: false, error: "rideId is required" });

    if (!isValidReason(body.reason)) {
      return res.status(400).json({ ok: false, error: "reason is required" });
    }

    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
    const reason = body.reason;

    const ride = await prisma.ride.findFirst({
      where: { id: rideId, driverId },
      select: {
        id: true,
        status: true,
        tripCompletedAt: true,
        totalPriceCents: true,
        departureTime: true,
        originCity: true,
        destinationCity: true,
        rider: {
          select: {
            id: true,
            email: true,
            name: true,
            stripeCustomerId: true,
            stripeDefaultPaymentId: true,
          },
        },
        driver: {
          select: {
            id: true,
            name: true,
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
    if (ride.status !== RideStatus.COMPLETED) {
      return res.status(400).json({ ok: false, error: "Ride must be COMPLETED." });
    }
    if (!ride.tripCompletedAt) {
      return res.status(400).json({ ok: false, error: "Ride missing tripCompletedAt." });
    }

    const completedMs = new Date(ride.tripCompletedAt).getTime();
    if (!Number.isFinite(completedMs)) {
      return res.status(400).json({ ok: false, error: "Invalid tripCompletedAt." });
    }

    const ageMs = Date.now() - completedMs;
    if (ageMs < 0 || ageMs > REPORT_WINDOW_MS) {
      return res.status(400).json({
        ok: false,
        error: "Unpaid can only be reported within 10 minutes of completion.",
      });
    }

    const booking = ride.bookings[0] ?? null;
    if (!booking?.id || !booking.riderId) {
      return res.status(400).json({ ok: false, error: "Booking/rider not found." });
    }

    if ((booking.paymentType ?? PaymentType.CARD) !== PaymentType.CASH) {
      return res.status(400).json({ ok: false, error: "Unpaid report is only valid for CASH rides." });
    }

    const fareBaseline = clampCents(booking.baseAmountCents) ?? clampCents(ride.totalPriceCents) ?? 0;
    const chargeCents = Math.max(0, Math.round(fareBaseline));
    if (chargeCents < 50) {
      return res.status(400).json({ ok: false, error: "Missing/invalid fare amount." });
    }

    const rider = ride.rider;
    if (!rider?.id) return res.status(400).json({ ok: false, error: "Missing rider on ride." });

    const customerId = rider.stripeCustomerId ?? null;
    if (!customerId) {
      return res.status(409).json({ ok: false, error: "Rider has no backup card on file. Cannot charge." });
    }

    let defaultPm: string | null = rider.stripeDefaultPaymentId ?? null;

    if (!defaultPm) {
      const customer = await stripe.customers.retrieve(customerId);
      if (!customer || (customer as any).deleted) {
        return res.status(409).json({ ok: false, error: "Billing customer missing." });
      }
      defaultPm = (customer as any)?.invoice_settings?.default_payment_method ?? null;
    }

    if (!defaultPm) {
      return res.status(409).json({ ok: false, error: "Rider has no default payment method. Cannot charge." });
    }

    const now = new Date();

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

    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        cashNotPaidAt: now,
        cashNotPaidByUserId: driverId,
        cashNotPaidNote: note || null,
        cashNotPaidReportedById: driverId,
        cashNotPaidReason: reason,

        cashDiscountRevokedAt: now,
        cashDiscountRevokedReason: `Driver reported unpaid cash (${reason})`,

        fallbackCardChargedAt: now,

        stripePaymentIntentId: piId,
        stripePaymentIntentStatus: piStatus || "unknown",

        paymentType: PaymentType.CARD,
        cashDiscountBps: 0,
        discountCents: 0,
        baseAmountCents: chargeCents,
        finalAmountCents: chargeCents,
      },
    });

    await createFallbackChargeNotification({
      riderId: rider.id,
      rideId: ride.id,
      bookingId: booking.id,
      driverId,
      amountCents: chargeCents,
      fallbackChargedAt: now,
      reason,
      note,
    });

    if (rider.email) {
      sendFallbackChargeAlertEmailSafe({
        riderEmail: rider.email,
        riderName: rider.name,
        driverName: ride.driver?.name ?? null,
        ride: {
          id: ride.id,
          originCity: ride.originCity,
          destinationCity: ride.destinationCity,
          departureTime: ride.departureTime,
        },
        amountCents: chargeCents,
        note,
      }).catch((err) => {
        console.error("[fallback-charge-email] Failed:", err);
      });
    }

    return res.status(200).json({
      ok: true,
      paymentIntentId: piId,
      chargedCents: chargeCents,
      currency: "usd",
    });
  } catch (err) {
    console.error("[driver/report-unpaid] error:", err);
    return res.status(500).json({ ok: false, error: asMessage(err) });
  }
}