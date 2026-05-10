// pages/api/driver/book-ride.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import {
  BookingStatus,
  PaymentType,
  RidePaymentStatus,
  RideStatus,
  UserRole,
} from "@prisma/client";
import { guardMembership } from "@/lib/guardMembership";

type Resp =
  | {
      ok: true;
      rideId: string;
      bookingId: string;
      payment?: {
        method: "CARD" | "CASH";
        authorizedAmountCents?: number;
        stripeStatus?: string;
      };
    }
  | { ok: false; error: string };

type BookRideBody = {
  rideId?: string;
};

function asMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown error";
}

function clampInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

async function getDefaultPaymentMethodForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      stripeCustomerId: true,
      stripeDefaultPaymentId: true,
    },
  });

  if (!user?.stripeCustomerId) return null;

  const dbPm = await prisma.paymentMethod.findFirst({
    where: {
      userId,
      isDefault: true,
      stripePaymentMethodId: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      stripePaymentMethodId: true,
    },
  });

  if (dbPm?.stripePaymentMethodId) {
    return {
      customerId: user.stripeCustomerId,
      paymentMethodId: dbPm.id,
      stripePaymentMethodId: dbPm.stripePaymentMethodId,
    };
  }

  if (user.stripeDefaultPaymentId) {
    return {
      customerId: user.stripeCustomerId,
      paymentMethodId: null as string | null,
      stripePaymentMethodId: user.stripeDefaultPaymentId,
    };
  }

  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Resp>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const user = session?.user as { id?: string; role?: UserRole | string } | undefined;
    const driverId = typeof user?.id === "string" ? user.id : undefined;

    if (!driverId) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (user?.role !== UserRole.DRIVER) {
      return res.status(403).json({ ok: false, error: "Only drivers can book rides." });
    }

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
        error: `Driver verification required to book rides. Status: ${profile.verificationStatus}`,
      });
    }

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

    const body = (req.body ?? {}) as BookRideBody;
    const rideId = typeof body.rideId === "string" ? body.rideId.trim() : "";

    if (!rideId) {
      return res.status(400).json({ ok: false, error: "rideId is required" });
    }

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        bookings: {
          where: { status: BookingStatus.PENDING },
          orderBy: { createdAt: "asc" },
          take: 1,
          include: {
            rider: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!ride) {
      return res.status(404).json({ ok: false, error: "Ride not found." });
    }

    if (ride.driverId && ride.driverId !== driverId) {
      return res.status(409).json({ ok: false, error: "Ride is already booked by another driver." });
    }

    if (ride.status !== RideStatus.OPEN && !(ride.status === RideStatus.ACCEPTED && ride.driverId === driverId)) {
      return res.status(400).json({
        ok: false,
        error: `Ride must be OPEN to be booked (current: ${ride.status}).`,
      });
    }

    const booking = ride.bookings[0] ?? null;
    if (!booking) {
      return res.status(400).json({ ok: false, error: "No pending booking found for this ride." });
    }

    const riderId = booking.riderId ? String(booking.riderId) : "";
    if (!riderId) {
      return res.status(400).json({ ok: false, error: "Booking is missing riderId." });
    }

    const paymentType = (booking.paymentType ?? PaymentType.CARD) as PaymentType;
    const estimatedFareCents =
      clampInt(booking.finalAmountCents) ??
      clampInt(ride.totalPriceCents) ??
      0;

    if (estimatedFareCents < 50) {
      return res.status(400).json({
        ok: false,
        error: "Estimated fare is missing or too small to authorize.",
      });
    }

    let paymentResponse:
      | {
          method: "CARD" | "CASH";
          authorizedAmountCents?: number;
          stripeStatus?: string;
        }
      | undefined;

    await prisma.$transaction(async (tx) => {
      await tx.ride.update({
        where: { id: ride.id },
        data: {
          driverId,
          status: RideStatus.ACCEPTED,
        },
      });

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.ACCEPTED,
        },
      });
    });

    if (paymentType === PaymentType.CARD) {
      const existingAuthorized = await prisma.ridePayment.findFirst({
        where: {
          rideId: ride.id,
          riderId,
          stripePaymentIntentId: { not: null },
          capturedAt: null,
          status: { in: [RidePaymentStatus.AUTHORIZED, RidePaymentStatus.PENDING] },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          amountCents: true,
          stripePaymentIntentId: true,
        },
      });

      if (!existingAuthorized) {
        const pm = await getDefaultPaymentMethodForUser(riderId);

        if (!pm?.customerId || !pm.stripePaymentMethodId) {
          return res.status(402).json({
            ok: false,
            error: "Rider has no default card available for authorization.",
          });
        }

        const bufferCents = Math.round(estimatedFareCents * 0.2);
        const authorizedAmountCents = estimatedFareCents + bufferCents;

        const pi = await stripe.paymentIntents.create({
          amount: authorizedAmountCents,
          currency: "usd",
          customer: pm.customerId,
          payment_method: pm.stripePaymentMethodId,
          confirm: true,
          off_session: true,
          capture_method: "manual",
          metadata: {
            kind: "ride_authorization",
            rideId: ride.id,
            bookingId: booking.id,
            riderId,
            driverId,
          },
        });

        if (
          pi.status !== "requires_capture" &&
          pi.status !== "requires_confirmation" &&
          pi.status !== "processing"
        ) {
          return res.status(402).json({
            ok: false,
            error: `Card authorization failed (status: ${pi.status}).`,
          });
        }

        await prisma.ridePayment.create({
          data: {
            rideId: ride.id,
            riderId,
            amountCents: authorizedAmountCents,
            currency: "usd",
            status: RidePaymentStatus.AUTHORIZED,
            provider: "STRIPE",
            paymentType: PaymentType.CARD,
            paymentMethodId: pm.paymentMethodId,
            stripePaymentIntentId: pi.id,
            baseAmountCents: estimatedFareCents,
            discountCents: 0,
            finalAmountCents: estimatedFareCents,
            idempotencyKey: `ride_auth:${ride.id}:${riderId}`,
          } as any,
        });

        paymentResponse = {
          method: "CARD",
          authorizedAmountCents,
          stripeStatus: pi.status,
        };
      } else {
        paymentResponse = {
          method: "CARD",
          authorizedAmountCents: existingAuthorized.amountCents,
          stripeStatus: "already_authorized",
        };
      }
    } else {
      paymentResponse = {
        method: "CASH",
      };
    }

    return res.status(200).json({
      ok: true,
      rideId: ride.id,
      bookingId: booking.id,
      ...(paymentResponse ? { payment: paymentResponse } : {}),
    });
  } catch (e) {
    console.error("[book-ride] error:", e);
    return res.status(500).json({ ok: false, error: asMessage(e) || "Server error" });
  }
}