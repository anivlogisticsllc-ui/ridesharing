// pages/api/rider/resend-receipt.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { RideStatus } from "@prisma/client";

import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { sendRideReceiptEmail } from "../../../lib/email";

type ApiResponse = { ok: true } | { ok: false; error: string };

type Body = {
  bookingId?: string;
};

type SessionUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: "RIDER" | "DRIVER";
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const user = session?.user as SessionUser | undefined;

  if (!user?.id) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const riderId = user.id;
  const { bookingId } = (req.body ?? {}) as Body;

  if (!bookingId || typeof bookingId !== "string") {
    return res.status(400).json({ ok: false, error: "bookingId is required" });
  }

  try {
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        riderId,
      },
      include: {
        rider: true,
        ride: {
          include: {
            driver: true,
          },
        },
      },
    });

    if (!booking || !booking.ride) {
      return res.status(404).json({
        ok: false,
        error: "Booking or ride not found",
      });
    }

    const ride = booking.ride;

    if (ride.status !== RideStatus.COMPLETED) {
      return res.status(400).json({
        ok: false,
        error: "Receipt is only available for completed rides.",
      });
    }

    if (!booking.rider?.email) {
      return res.status(400).json({
        ok: false,
        error: "No email is associated with this booking.",
      });
    }

    const latestPayment = await prisma.ridePayment.findFirst({
      where: {
        rideId: ride.id,
        riderId,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        baseAmountCents: true,
        tipAmountCents: true,
        finalAmountCents: true,
      },
    });

    const baseAmountCents =
      typeof latestPayment?.baseAmountCents === "number"
        ? latestPayment.baseAmountCents
        : ride.totalPriceCents ?? 0;

    const tipAmountCents =
      typeof latestPayment?.tipAmountCents === "number"
        ? latestPayment.tipAmountCents
        : 0;

    const finalAmountCents =
      typeof latestPayment?.finalAmountCents === "number"
        ? latestPayment.finalAmountCents
        : baseAmountCents + tipAmountCents;

    void sendRideReceiptEmail({
      riderEmail: booking.rider.email,
      riderName: booking.rider.name,
      driverName: ride.driver?.name,
      ride: {
        id: ride.id,
        status: ride.status,
        originCity: ride.originCity,
        originLat: ride.originLat,
        originLng: ride.originLng,
        destinationCity: ride.destinationCity,
        destinationLat: ride.destinationLat,
        destinationLng: ride.destinationLng,
        departureTime: ride.departureTime,
        tripStartedAt: ride.tripStartedAt,
        tripCompletedAt: ride.tripCompletedAt,
        passengerCount: ride.passengerCount,
        distanceMiles: ride.distanceMiles,
        totalPriceCents: finalAmountCents,
      },
    }).catch((err) => {
      console.error("[receipt-email] Failed to resend receipt:", err);
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[resend-receipt] error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to resend receipt",
    });
  }
}