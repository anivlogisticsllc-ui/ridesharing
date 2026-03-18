// pages/api/receipt/email.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { DisputeStatus, RideStatus, PaymentType } from "@prisma/client";

import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import {
  sendRideReceiptEmail,
  sendDriverReceiptEmail,
  type RideReceiptSnapshot,
} from "@/lib/email";

type ApiResponse = { ok: true } | { ok: false; error: string };

function toStr(v: unknown) {
  return typeof v === "string" ? v : "";
}

function asInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

function clampCents(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

function toPaymentLabel(pt: PaymentType | null | undefined): "CARD" | "CASH" | null {
  if (pt === PaymentType.CARD) return "CARD";
  if (pt === PaymentType.CASH) return "CASH";
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const user = session?.user as any;

  const userId = toStr(user?.id).trim();
  const userEmail = toStr(user?.email).trim();

  if (!userId || !userEmail) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const bookingId = toStr((req.body as any)?.bookingId).trim();
  if (!bookingId) {
    return res.status(400).json({ ok: false, error: "Missing bookingId" });
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      rider: { select: { id: true, name: true, email: true } },
      ride: {
        include: {
          driver: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (!booking?.ride) {
    return res.status(404).json({ ok: false, error: "Receipt not found" });
  }

  const ride = booking.ride;

  if (ride.status !== RideStatus.COMPLETED) {
    return res
      .status(400)
      .json({ ok: false, error: "Receipt is only available for completed rides." });
  }

  const isRider = booking.rider?.id === userId;
  const isDriver = ride.driver?.id === userId;

  if (!isRider && !isDriver) {
    return res.status(403).json({ ok: false, error: "Not allowed" });
  }

  const dispute = await prisma.dispute.findFirst({
    where: {
      bookingId: booking.id,
      rideId: ride.id,
      status: DisputeStatus.RESOLVED_RIDER,
      refundIssued: true,
    },
    orderBy: [
      { refundIssuedAt: "desc" },
      { resolvedAt: "desc" },
      { createdAt: "desc" },
    ],
    select: {
      id: true,
      refundIssued: true,
      refundAmountCents: true,
      refundIssuedAt: true,
      resolvedAt: true,
    },
  });

  const originDisplay =
    toStr((ride as any).originAddress).trim() || toStr((ride as any).originCity).trim();

  const destDisplay =
    toStr((ride as any).destinationAddress).trim() || toStr((ride as any).destinationCity).trim();

  // Source of truth: booking amounts first, then ride fallback
  const base =
    asInt((booking as any).baseAmountCents) ??
    asInt((ride as any).totalPriceCents) ??
    0;

  const disc =
    booking.originalPaymentType === PaymentType.CASH &&
    booking.paymentType === PaymentType.CARD &&
    booking.cashNotPaidAt &&
    booking.fallbackCardChargedAt
      ? 0
      : asInt((booking as any).discountCents) ?? 0;

  const final =
    asInt((booking as any).finalAmountCents) ??
    Math.max(0, base - disc);

  const netAfterDiscount = Math.max(0, base - disc);
  const fee = Math.max(0, final - netAfterDiscount);

  const baseFareCents = clampCents(base);
  const discountCents = clampCents(disc);
  const convenienceFeeCents = clampCents(fee);
  const finalTotalCents = clampCents(final);

  const snapshot: RideReceiptSnapshot = {
    id: ride.id,
    status: ride.status,

    originCity: originDisplay,
    originLat: ride.originLat,
    originLng: ride.originLng,

    destinationCity: destDisplay,
    destinationLat: ride.destinationLat,
    destinationLng: ride.destinationLng,

    departureTime: ride.departureTime,
    tripStartedAt: ride.tripStartedAt,
    tripCompletedAt: ride.tripCompletedAt,

    passengerCount: ride.passengerCount,
    distanceMiles: ride.distanceMiles,

    totalPriceCents: finalTotalCents,

    bookingId: booking.id,
    paymentType: toPaymentLabel(booking.paymentType),
    originalPaymentType: toPaymentLabel(booking.originalPaymentType),

    baseFareCents,
    convenienceFeeCents,
    discountCents,
    finalTotalCents,

    cashNotPaidAt: booking.cashNotPaidAt,
    cashDiscountRevokedAt: booking.cashDiscountRevokedAt,
    fallbackCardChargedAt: booking.fallbackCardChargedAt,
    cashNotPaidReason: booking.cashNotPaidReason ?? null,
    cashNotPaidNote: booking.cashNotPaidNote ?? null,

    refundIssued: dispute?.refundIssued ?? false,
    refundAmountCents: clampCents(dispute?.refundAmountCents),
    refundIssuedAt: dispute?.refundIssuedAt ?? null,
    disputeResolvedAt: dispute?.resolvedAt ?? null,
  };

  if (isDriver) {
    await sendDriverReceiptEmail({
      driverEmail: userEmail,
      driverName: ride.driver?.name ?? user?.name ?? null,
      riderName: booking.rider?.name ?? null,
      riderEmail: booking.rider?.email ?? null,
      ride: snapshot,
    });

    return res.status(200).json({ ok: true });
  }

  await sendRideReceiptEmail({
    riderEmail: userEmail,
    riderName: booking.rider?.name ?? null,
    riderEmailLabel: booking.rider?.email ?? null,
    driverName: ride.driver?.name ?? null,
    driverEmail: ride.driver?.email ?? null,
    ride: snapshot,
  });

  return res.status(200).json({ ok: true });
}
