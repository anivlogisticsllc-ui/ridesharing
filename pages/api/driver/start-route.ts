// pages/api/driver/start-route.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { BookingStatus, RideStatus, UserRole } from "@prisma/client";
import { guardMembership } from "@/lib/guardMembership";

type ApiResponse = { ok: true; rideId: string } | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const session = await getServerSession(req, res, authOptions);
    const driverId = (session?.user as any)?.id as string | undefined;
    const role = (session?.user as any)?.role as UserRole | undefined;

    if (!driverId) return res.status(401).json({ ok: false, error: "Not authenticated" });
    if (role !== UserRole.DRIVER) {
      return res.status(403).json({ ok: false, error: "Only drivers can start a ride." });
    }

    const { rideId } = (req.body ?? {}) as { rideId?: string };
    if (!rideId) return res.status(400).json({ ok: false, error: "rideId is required" });

    // Verification gate
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

    // Membership gate (DRIVER)
    const gate = await guardMembership({ userId: driverId, role: UserRole.DRIVER, allowTrial: true });
    if (!gate.ok) {
      return res.status(403).json({ ok: false, error: gate.error || "Membership required." });
    }

    // Prevent multiple active rides (keep as-is, but do it inside transaction for better correctness)
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const otherActive = await tx.ride.findFirst({
        where: { driverId, status: RideStatus.IN_ROUTE, id: { not: rideId } },
        select: { id: true },
      });

      if (otherActive) {
        const e = new Error("You already have a ride in progress. Complete it before starting a new one.");
        (e as any).httpStatus = 409;
        throw e;
      }

      // Optional sanity: ensure there is an accepted booking (ride shouldn't be started without a rider booking)
      const hasAcceptedBooking = await tx.booking.findFirst({
        where: { rideId, status: BookingStatus.ACCEPTED },
        select: { id: true },
      });

      if (!hasAcceptedBooking) {
        const e = new Error("Cannot start route: no accepted booking found for this ride.");
        (e as any).httpStatus = 400;
        throw e;
      }

      // Atomic transition: ACCEPTED -> IN_ROUTE, only if:
      // - ride belongs to this driver
      // - ride is currently ACCEPTED
      // - tripStartedAt is still null (prevents overwriting)
      const updated = await tx.ride.updateMany({
        where: {
          id: rideId,
          driverId,
          status: RideStatus.ACCEPTED,
          tripStartedAt: null,
        },
        data: {
          status: RideStatus.IN_ROUTE,
          tripStartedAt: now,
        },
      });

      if (updated.count === 1) {
        return { ok: true as const };
      }

      // If nothing updated, determine why for better message
      const ride = await tx.ride.findFirst({
        where: { id: rideId, driverId },
        select: { status: true, tripStartedAt: true },
      });

      if (!ride) {
        const e = new Error("Ride not found for this driver.");
        (e as any).httpStatus = 404;
        throw e;
      }

      if (ride.tripStartedAt) {
        // Idempotent-ish behavior: already started
        const e = new Error("Ride already started.");
        (e as any).httpStatus = 409;
        throw e;
      }

      const e = new Error(`Ride must be in ACCEPTED status to start. Current status: ${ride.status}`);
      (e as any).httpStatus = 400;
      throw e;
    });

    if (result.ok) {
      return res.status(200).json({ ok: true, rideId });
    }

    return res.status(500).json({ ok: false, error: "Failed to start route." });
  } catch (err: any) {
    const status = err?.httpStatus as number | undefined;
    const message = err?.message ? String(err.message) : "Failed to start route.";
    console.error("Error starting route:", err);
    return res.status(status ?? 500).json({ ok: false, error: message });
  }
}
