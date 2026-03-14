import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import {
  BookingStatus,
  DisputeReason,
  DisputeStatus,
  NotificationType,
  PaymentType,
  RidePaymentStatus,
  RideStatus,
  UserRole,
} from "@prisma/client";

type Body = {
  bookingId?: string;
  reason?: "CASH_ALREADY_PAID" | "UNAUTHORIZED_FALLBACK_CHARGE" | "OTHER";
  riderStatement?: string;
};

type ApiResponse =
  | {
      ok: true;
      dispute: {
        id: string;
        status: string;
        bookingId: string;
        rideId: string;
        reason: string;
        createdAt: string;
      };
    }
  | { ok: false; error: string };

function asMessage(err: unknown) {
  return err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
}

function isValidReason(v: unknown): v is Body["reason"] {
  return v === "CASH_ALREADY_PAID" || v === "UNAUTHORIZED_FALLBACK_CHARGE" || v === "OTHER";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const user = session?.user as { id?: unknown; role?: unknown } | undefined;

    const riderId = typeof user?.id === "string" ? user.id : "";
    if (!riderId) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (user?.role !== UserRole.RIDER) {
      return res.status(403).json({ ok: false, error: "Only riders can create disputes." });
    }

    const body = (req.body ?? {}) as Body;

    const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim() : "";
    if (!bookingId) {
      return res.status(400).json({ ok: false, error: "bookingId is required" });
    }

    if (!isValidReason(body.reason)) {
      return res.status(400).json({ ok: false, error: "Valid dispute reason is required" });
    }

    const riderStatement =
      typeof body.riderStatement === "string" ? body.riderStatement.trim().slice(0, 3000) : "";

    if (!riderStatement) {
      return res.status(400).json({ ok: false, error: "Please enter your statement" });
    }

    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        riderId,
      },
      select: {
        id: true,
        rideId: true,
        riderId: true,
        paymentType: true,
        status: true,
        cashNotPaidAt: true,
        fallbackCardChargedAt: true,
        stripePaymentIntentId: true,
        ride: {
          select: {
            id: true,
            status: true,
            driverId: true,
          },
        },
      },
    });

    if (!booking?.ride) {
      return res.status(404).json({ ok: false, error: "Booking not found" });
    }

    if (booking.status !== BookingStatus.COMPLETED || booking.ride.status !== RideStatus.COMPLETED) {
      return res.status(400).json({ ok: false, error: "Only completed rides can be disputed." });
    }

    if (
      booking.paymentType !== PaymentType.CARD ||
      !booking.cashNotPaidAt ||
      !booking.fallbackCardChargedAt
    ) {
      return res.status(400).json({
        ok: false,
        error: "This booking does not have a fallback card charge to dispute.",
      });
    }

    const existingOpen = await prisma.dispute.findFirst({
      where: {
        bookingId: booking.id,
        riderId,
        status: {
          in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW],
        },
      },
      select: { id: true },
    });

    if (existingOpen) {
      return res.status(409).json({
        ok: false,
        error: "An open dispute already exists for this charge.",
      });
    }

    const ridePayment = await prisma.ridePayment.findFirst({
      where: {
        rideId: booking.rideId,
        riderId,
        paymentType: PaymentType.CARD,
        status: RidePaymentStatus.SUCCEEDED,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const created = await prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.create({
        data: {
          rideId: booking.ride.id,
          bookingId: booking.id,
          ridePaymentId: ridePayment?.id ?? null,
          riderId,
          driverId: booking.ride.driverId ?? null,
          reason: body.reason as DisputeReason,
          status: DisputeStatus.OPEN,
          riderStatement,
        },
        select: {
          id: true,
          status: true,
          bookingId: true,
          rideId: true,
          reason: true,
          createdAt: true,
        },
      });

      await tx.notification.create({
        data: {
          userId: riderId,
          rideId: booking.ride.id,
          bookingId: booking.id,
          type: NotificationType.DISPUTE_OPENED,
          title: "Dispute submitted",
          message: "Your dispute was submitted and is awaiting admin review.",
          metadata: {
            disputeId: dispute.id,
            bookingId: booking.id,
            rideId: booking.ride.id,
          },
        },
      });

      return dispute;
    });

    return res.status(200).json({
      ok: true,
      dispute: {
        id: created.id,
        status: String(created.status),
        bookingId: created.bookingId,
        rideId: created.rideId,
        reason: String(created.reason),
        createdAt: created.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[rider/disputes/create] error:", err);
    return res.status(500).json({ ok: false, error: asMessage(err) });
  }
}