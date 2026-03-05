// pages/api/rider/outstanding-charge/action.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import {
  OutstandingChargeStatus,
  UserRole,
  PaymentType,
  BookingStatus,
} from "@prisma/client";
import { sendOutstandingChargePaidEmail } from "@/lib/emails/outstandingChargePaid";
import { computeConvenienceFeeCents } from "@/lib/convenienceFee";

type Body = { oc?: string; action?: "PAY" | "DISPUTE" };

type ApiResponse =
  | { ok: true; status: OutstandingChargeStatus }
  | { ok: false; error: string };

function isRider(role: unknown): boolean {
  return role === UserRole.RIDER || role === "RIDER";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const user = session?.user as { id?: unknown; role?: unknown } | undefined;

    const userId = typeof user?.id === "string" ? user.id : "";
    if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" });

    if (!isRider(user?.role)) {
      return res.status(403).json({ ok: false, error: "Only riders can take this action." });
    }

    const body = (req.body ?? {}) as Body;
    const ocId = typeof body.oc === "string" ? body.oc.trim() : "";
    const action = body.action;

    if (!ocId) return res.status(400).json({ ok: false, error: "oc is required" });
    if (action !== "PAY" && action !== "DISPUTE") {
      return res.status(400).json({ ok: false, error: "Invalid action" });
    }

    const oc = await prisma.outstandingCharge.findFirst({
      where: { id: ocId, riderId: userId },
      select: {
        id: true,
        status: true,
        riderId: true,
        rideId: true,
        bookingId: true,
        totalCents: true,
        fareCents: true,
        convenienceFeeCents: true,
        currency: true,
        rider: { select: { email: true, name: true } },
        ride: {
          select: {
            id: true,
            totalPriceCents: true,
            riderId: true,
            originCity: true,
            destinationCity: true,
          },
        },
      },
    });

    if (!oc) return res.status(404).json({ ok: false, error: "Outstanding charge not found." });

    // Idempotent responses
    if (action === "PAY" && oc.status === OutstandingChargeStatus.PAID) {
      return res.status(200).json({ ok: true, status: oc.status });
    }
    if (action === "DISPUTE" && oc.status === OutstandingChargeStatus.DISPUTED) {
      return res.status(200).json({ ok: true, status: oc.status });
    }

    if (oc.status !== OutstandingChargeStatus.OPEN) {
      return res.status(400).json({
        ok: false,
        error: `This item is not OPEN (current: ${oc.status}).`,
      });
    }

    if (action === "DISPUTE") {
      const updated = await prisma.outstandingCharge.update({
        where: { id: oc.id },
        data: {
          status: OutstandingChargeStatus.DISPUTED,
          disputedAt: new Date(),
          resolvedAt: new Date(),
        },
        select: { status: true },
      });

      return res.status(200).json({ ok: true, status: updated.status });
    }

    // PAY flow
    const now = new Date();

    const txResult = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: oc.bookingId },
        select: {
          id: true,
          rideId: true,
          status: true,
          paymentType: true,
          cashDiscountBps: true,
          baseAmountCents: true,
          discountCents: true,
          finalAmountCents: true,
        },
      });

      if (!booking) {
        throw new Error("Booking not found for this outstanding charge.");
      }

      // Base “no discount” fare:
      const baseNoDiscount =
        typeof booking.baseAmountCents === "number" && booking.baseAmountCents > 0
          ? booking.baseAmountCents
          : typeof oc.ride.totalPriceCents === "number" && oc.ride.totalPriceCents > 0
          ? oc.ride.totalPriceCents
          : oc.fareCents;

      const fee = computeConvenienceFeeCents(baseNoDiscount);
      const total = baseNoDiscount + fee;

      // Mark OC paid and store the final truth (fare + fee)
      const updatedOc = await tx.outstandingCharge.update({
        where: { id: oc.id },
        data: {
          status: OutstandingChargeStatus.PAID,
          paidAt: now,
          resolvedAt: now,
          fareCents: baseNoDiscount,
          convenienceFeeCents: fee,
          totalCents: total,
        },
        select: { id: true, status: true, totalCents: true },
      });

      // Update booking so all UIs/receipts can trust it
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          paymentType: PaymentType.CARD,
          cashDiscountBps: 0,
          discountCents: 0,
          baseAmountCents: baseNoDiscount,
          finalAmountCents: total,
          status: BookingStatus.COMPLETED,
        },
      });

      if (!oc.ride.riderId) {
        await tx.ride.update({
          where: { id: oc.rideId },
          data: { riderId: userId },
        });
      }

      return { updatedOc, totalCents: total };
    });

    // Best-effort email
    const riderEmail = oc.rider?.email || "";
    if (riderEmail) {
      sendOutstandingChargePaidEmail({
        riderEmail,
        riderName: oc.rider?.name ?? null,
        outstandingChargeId: oc.id,
        rideId: oc.rideId,
        amountCents: txResult.totalCents,
        paymentType: "CARD",
      }).catch((e) => console.error("[rider/outstanding-charge/action] paid email failed:", e));
    }

    return res.status(200).json({ ok: true, status: txResult.updatedOc.status });
  } catch (err) {
    console.error("[rider/outstanding-charge/action] error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}