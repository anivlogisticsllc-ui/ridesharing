// pages/api/driver/complete-ride.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { RideStatus, BookingStatus, UserRole } from "@prisma/client";
import { guardMembership } from "@/lib/guardMembership";
import { computeDistanceMiles } from "@/lib/distance";

type ApiResponse = { ok: true } | { ok: false; error: string };

type CompleteRideBody = {
  rideId?: string;
  elapsedSeconds?: number | null;
  distanceMiles?: number | null;
  fareCents?: number | null;
};

// If you already have this function in this file, KEEP it.
// Otherwise, leave this stub and we’ll wire it later.
async function sendRideReceiptEmailSafe(_args: any) {
  // no-op by default
  return;
}

function asMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown error";
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
    const user = session?.user as any;

    if (!user?.id) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (user.role !== UserRole.DRIVER) {
      return res
        .status(403)
        .json({ ok: false, error: "Only drivers can complete rides." });
    }

    const driverId = String(user.id);

    // ✅ Verification gate
    const profile = await prisma.driverProfile.findUnique({
      where: { userId: driverId },
      select: { verificationStatus: true },
    });

    if (!profile) {
      return res.status(403).json({
        ok: false,
        error: "Driver profile missing. Complete driver setup first.",
      });
    }

    if (profile.verificationStatus !== "APPROVED") {
      return res.status(403).json({
        ok: false,
        error: `Driver verification required. Status: ${profile.verificationStatus}`,
      });
    }

    // ✅ Membership gate (DRIVER) — allow trial for MVP
    const gate = await guardMembership({
      userId: driverId,
      role: UserRole.DRIVER,
      allowTrial: true,
    });

    if (!gate.ok) {
      return res.status(403).json({
        ok: false,
        error: gate.error || "Membership required.",
      });
    }

    const { rideId, distanceMiles, fareCents } = (req.body ?? {}) as CompleteRideBody;

    if (!rideId) {
      return res.status(400).json({ ok: false, error: "rideId is required" });
    }

    const ride = await prisma.ride.findFirst({
      where: { id: rideId, driverId },
      include: {
        bookings: {
          where: { status: { in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED] } },
          take: 1,
          include: { rider: true },
        },
        driver: true,
      },
    });

    if (!ride) {
      return res
        .status(404)
        .json({ ok: false, error: "Ride not found for this driver." });
    }

    if (ride.status === RideStatus.COMPLETED) {
      return res.status(200).json({ ok: true });
    }

    if (ride.status !== RideStatus.ACCEPTED && ride.status !== RideStatus.IN_ROUTE) {
      return res.status(400).json({
        ok: false,
        error: `Ride must be in ACCEPTED or IN_ROUTE to complete (current: ${ride.status}).`,
      });
    }

    const booking = ride.bookings[0] ?? null;

    let finalDistanceMiles: number | null | undefined = null;

    if (typeof distanceMiles === "number" && distanceMiles > 0) {
      finalDistanceMiles = distanceMiles;
    } else if (typeof ride.distanceMiles === "number" && ride.distanceMiles > 0) {
      finalDistanceMiles = ride.distanceMiles;
    } else if (
      ride.originLat != null &&
      ride.originLng != null &&
      ride.destinationLat != null &&
      ride.destinationLng != null
    ) {
      finalDistanceMiles = computeDistanceMiles(
        ride.originLat,
        ride.originLng,
        ride.destinationLat,
        ride.destinationLng
      );
    }

    const finalFareCents =
      typeof fareCents === "number" ? fareCents : ride.totalPriceCents ?? null;

    const completionTime = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.ride.update({
        where: { id: ride.id },
        data: {
          status: RideStatus.COMPLETED,
          tripCompletedAt: completionTime,
          distanceMiles: finalDistanceMiles ?? undefined,
          totalPriceCents: finalFareCents ?? undefined,
        },
      });

      if (booking) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { status: BookingStatus.COMPLETED },
        });
      }
    });

    // Respond first. Email is best-effort and must not break ride completion.
    res.status(200).json({ ok: true });

    // Best-effort email after response (won’t affect client)
    if (booking?.rider?.email) {
      sendRideReceiptEmailSafe({
        riderEmail: booking.rider.email,
        riderName: booking.rider.name,
        driverName: ride.driver?.name,
        ride: {
          id: ride.id,
          originCity: ride.originCity,
          destinationCity: ride.destinationCity,
          departureTime: ride.departureTime,
          distanceMiles: finalDistanceMiles ?? undefined,
          totalPriceCents: finalFareCents ?? undefined,
        },
      }).catch((err) => {
        console.error("[receipt-email] Failed:", err);
      });
    }

    return;
  } catch (err) {
    // IMPORTANT: return the real error message so UI can show it
    const msg = asMessage(err);
    console.error("Error completing ride:", err);
    return res.status(500).json({ ok: false, error: msg || "Failed to complete ride." });
  }
}
