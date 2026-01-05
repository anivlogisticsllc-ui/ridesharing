// pages/api/book-ride.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { BookingStatus, RideStatus, UserRole, PaymentType } from "@prisma/client";
import { guardMembership } from "@/lib/guardMembership";

type ApiResponse =
  | { ok: true; bookingId: string; conversationId: string }
  | { ok: false; error: string };

function computeReceipt(baseCents: number, cashDiscountBps: number) {
  const discountCents =
    cashDiscountBps > 0 ? Math.round(baseCents * (cashDiscountBps / 10000)) : 0;
  const finalAmountCents = Math.max(0, baseCents - discountCents);
  return { baseAmountCents: baseCents, discountCents, finalAmountCents };
}

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
      return res.status(403).json({ ok: false, error: "Only drivers can accept rider requests." });
    }

    // Driver verification gate
    const profile = await prisma.driverProfile.findUnique({
      where: { userId: driverId },
      select: { verificationStatus: true },
    });

    if (!profile) {
      return res.status(403).json({ ok: false, error: "Driver profile missing. Complete driver setup first." });
    }
    if (profile.verificationStatus !== "APPROVED") {
      return res.status(403).json({
        ok: false,
        error: `Driver verification required to accept rides. Status: ${profile.verificationStatus}`,
      });
    }

    // Membership gate (DRIVER)
    const gate = await guardMembership({ userId: driverId, role: UserRole.DRIVER, allowTrial: true });
    if (!gate.ok) {
      return res.status(403).json({ ok: false, error: gate.error || "Membership required." });
    }

    const { rideId } = (req.body ?? {}) as { rideId?: string };
    if (!rideId) return res.status(400).json({ ok: false, error: "rideId is required." });

    // Prevent multiple active rides
    const activeRide = await prisma.ride.findFirst({
      where: {
        driverId,
        status: { in: [RideStatus.ACCEPTED, RideStatus.IN_ROUTE] },
        NOT: { id: rideId },
      },
      select: { id: true },
    });

    if (activeRide) {
      return res.status(400).json({
        ok: false,
        error: "You already have an active ride. Complete it before accepting a new one.",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const ride = await tx.ride.findUnique({
        where: { id: rideId },
        select: { id: true, riderId: true, status: true, driverId: true, totalPriceCents: true },
      });

      if (!ride || !ride.riderId) throw new Error("Ride not found.");
      if (ride.status === RideStatus.COMPLETED || ride.status === RideStatus.IN_ROUTE) {
        throw new Error("This ride is no longer available to accept.");
      }
      if (ride.driverId && ride.driverId !== driverId) {
        const e = new Error("Ride was already accepted by another driver.");
        (e as any).code = "TAKEN";
        throw e;
      }

      // Race-safe accept
      const updated = await tx.ride.updateMany({
        where: {
          id: ride.id,
          OR: [{ driverId: null }, { driverId }],
          status: { notIn: [RideStatus.COMPLETED, RideStatus.IN_ROUTE] },
        },
        data: { driverId, status: RideStatus.ACCEPTED },
      });

      if (updated.count === 0) {
        const e = new Error("Ride was already accepted by another driver.");
        (e as any).code = "TAKEN";
        throw e;
      }

      // Reuse rider booking (payment choice lives there)
      const existing = await tx.booking.findFirst({
        where: {
          rideId: ride.id,
          riderId: ride.riderId,
          status: { in: [BookingStatus.PENDING, BookingStatus.ACCEPTED] },
        },
        orderBy: { createdAt: "asc" as any },
        select: {
          id: true,
          status: true,
          paymentType: true,
          cashDiscountBps: true,
          baseAmountCents: true,
          discountCents: true,
          finalAmountCents: true,
        },
      });

      // If already accepted: ensure conversation exists and return
      if (existing?.status === BookingStatus.ACCEPTED) {
        const convo = await tx.conversation.upsert({
          where: { bookingId: existing.id },
          update: {},
          create: {
            rideId: ride.id,
            driverId,
            riderId: ride.riderId,
            bookingId: existing.id,
          },
        });
        return { bookingId: existing.id, conversationId: convo.id };
      }

      const baseAmountCents = ride.totalPriceCents ?? 0;

      let bookingId: string;

      if (existing) {
        const needsSnapshot =
          !(typeof existing.baseAmountCents === "number" && existing.baseAmountCents > 0) ||
          !(typeof existing.finalAmountCents === "number" && existing.finalAmountCents > 0);

        const cashBps = typeof existing.cashDiscountBps === "number" ? existing.cashDiscountBps : 0;

        const receipt =
          existing.paymentType === PaymentType.CASH
            ? computeReceipt(baseAmountCents, cashBps)
            : { baseAmountCents, discountCents: 0, finalAmountCents: baseAmountCents };

        const updatedBooking = await tx.booking.update({
          where: { id: existing.id },
          data: {
            status: BookingStatus.ACCEPTED,
            ...(needsSnapshot
              ? {
                  currency: "usd",
                  baseAmountCents: receipt.baseAmountCents,
                  discountCents: receipt.discountCents,
                  finalAmountCents: receipt.finalAmountCents,
                }
              : {}),
          } as any,
        });

        bookingId = updatedBooking.id;
      } else {
        // Fallback if missing booking (should be rare)
        const receipt = { baseAmountCents, discountCents: 0, finalAmountCents: baseAmountCents };
        const created = await tx.booking.create({
          data: {
            rideId: ride.id,
            riderId: ride.riderId,
            status: BookingStatus.ACCEPTED,
            paymentType: PaymentType.CARD,
            cashDiscountBps: 0,
            paymentMethodId: null,
            currency: "usd",
            baseAmountCents: receipt.baseAmountCents,
            discountCents: receipt.discountCents,
            finalAmountCents: receipt.finalAmountCents,
          } as any,
        });
        bookingId = created.id;
      }

      const conversation = await tx.conversation.create({
        data: {
          rideId: ride.id,
          driverId,
          riderId: ride.riderId,
          bookingId,
        },
      });

      return { bookingId, conversationId: conversation.id };
    });

    return res.status(201).json({ ok: true, bookingId: result.bookingId, conversationId: result.conversationId });
  } catch (err: any) {
    console.error("Error in /api/book-ride:", err);
    const msg = String(err?.message || "");
    if (msg.includes("already accepted") || err?.code === "TAKEN") {
      return res.status(409).json({ ok: false, error: msg });
    }
    return res.status(500).json({ ok: false, error: "Failed to accept ride. Please try again." });
  }
}
