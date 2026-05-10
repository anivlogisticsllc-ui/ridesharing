// pages/api/driver/complete-ride.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import {
  BookingStatus,
  PaymentType,
  RidePaymentStatus,
  RideStatus,
  TipStatus,
  TransactionStatus,
  UserRole,
} from "@prisma/client";

import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { guardMembership } from "@/lib/guardMembership";
import { computeDistanceMiles } from "@/lib/distance";

type ApiResponse =
  | {
      ok: true;
      payment?: {
        method: "CARD" | "CASH";
        amountCents: number;
        stripeStatus?: string;
      };
      billing?: {
        finalFareCents: number;
        collectedAmountCents: number;
        outstandingAmountCents: number;
        note?: string;
      };
    }
  | { ok: false; error: string };

type CompleteRideBody = {
  rideId?: string;
  elapsedSeconds?: number | null;
  distanceMiles?: number | null;
  fareCents?: number | null;
  unpaid?: boolean;
  note?: string | null;
};

const PLATFORM_FEE_BPS = 1000;
const TIP_WINDOW_MS = 24 * 60 * 60 * 1000;

function asMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown error";
}

function clampInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function clampCashDiscountBps(bps: unknown) {
  if (typeof bps !== "number" || !Number.isFinite(bps)) return 0;
  return Math.min(5000, Math.max(0, Math.round(bps)));
}

function computeReceipt(baseCents: number, cashDiscountBps: number) {
  const baseAmountCents = Math.max(0, Math.round(baseCents));
  const bps = clampCashDiscountBps(cashDiscountBps);
  const discountCents = bps > 0 ? Math.round(baseAmountCents * (bps / 10000)) : 0;
  const finalAmountCents = Math.max(0, baseAmountCents - discountCents);

  return {
    baseAmountCents,
    discountCents,
    finalAmountCents,
  };
}

function computeDriverSplit(collectedAmountCents: number) {
  const grossAmountCents = Math.max(0, Math.round(collectedAmountCents));
  const serviceFeeCents = Math.round(grossAmountCents * (PLATFORM_FEE_BPS / 10000));
  const netAmountCents = Math.max(0, grossAmountCents - serviceFeeCents);

  return {
    grossAmountCents,
    serviceFeeCents,
    netAmountCents,
  };
}

async function upsertCashPaymentAndTransaction(args: {
  rideId: string;
  riderId: string;
  driverId: string;
  baseAmountCents: number;
  discountCents: number;
  finalAmountCents: number;
}) {
  const paymentKey = `cash_complete:${args.rideId}:${args.riderId}`;
  const split = computeDriverSplit(args.finalAmountCents);
  const now = new Date();

  const existingPayment = await prisma.ridePayment.findFirst({
    where: { idempotencyKey: paymentKey },
    select: { id: true },
  });

  if (existingPayment) {
    await prisma.ridePayment.update({
      where: { id: existingPayment.id },
      data: {
        amountCents: args.finalAmountCents,
        currency: "usd",
        status: RidePaymentStatus.SUCCEEDED,
        provider: "CASH",
        paymentType: PaymentType.CASH,
        baseAmountCents: args.baseAmountCents,
        discountCents: args.discountCents,
        finalAmountCents: args.finalAmountCents,
        capturedAt: now,
      } as any,
    });
  } else {
    await prisma.ridePayment.create({
      data: {
        rideId: args.rideId,
        riderId: args.riderId,
        amountCents: args.finalAmountCents,
        currency: "usd",
        status: RidePaymentStatus.SUCCEEDED,
        provider: "CASH",
        paymentType: PaymentType.CASH,
        baseAmountCents: args.baseAmountCents,
        discountCents: args.discountCents,
        finalAmountCents: args.finalAmountCents,
        capturedAt: now,
        idempotencyKey: paymentKey,
      } as any,
    });
  }

  const existingTransaction = await prisma.transaction.findFirst({
    where: {
      rideId: args.rideId,
      driverId: args.driverId,
    },
    select: { id: true },
  });

  if (existingTransaction) {
    await prisma.transaction.update({
      where: { id: existingTransaction.id },
      data: {
        grossAmountCents: split.grossAmountCents,
        serviceFeeCents: split.serviceFeeCents,
        netAmountCents: split.netAmountCents,
        status: TransactionStatus.COMPLETED,
      },
    });
  } else {
    await prisma.transaction.create({
      data: {
        rideId: args.rideId,
        driverId: args.driverId,
        grossAmountCents: split.grossAmountCents,
        serviceFeeCents: split.serviceFeeCents,
        netAmountCents: split.netAmountCents,
        status: TransactionStatus.COMPLETED,
      },
    });
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  const startedAt = Date.now();
  const mark = (label: string) => {
    console.log(`[complete-ride] ${label}: ${Date.now() - startedAt}ms`);
  };

  mark("start");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    mark("before session");
    const session = await getServerSession(req, res, authOptions);
    mark("after session");

    const user = session?.user as { id?: string; role?: UserRole | string } | undefined;

    if (!user?.id) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (user.role !== UserRole.DRIVER) {
      return res.status(403).json({
        ok: false,
        error: "Only drivers can complete rides.",
      });
    }

    const body = (req.body ?? {}) as CompleteRideBody;
    const rideId = typeof body.rideId === "string" ? body.rideId.trim() : "";

    if (!rideId) {
      return res.status(400).json({ ok: false, error: "rideId is required" });
    }

    const driverId = String(user.id);

    mark("before profile/gate/ride");
    const [profile, gate, ride] = await Promise.all([
      prisma.driverProfile.findUnique({
        where: { userId: driverId },
        select: { verificationStatus: true },
      }),

      guardMembership({
        userId: driverId,
        role: UserRole.DRIVER,
        allowTrial: true,
      }),

      prisma.ride.findFirst({
        where: { id: rideId, driverId },
        include: {
          bookings: {
            where: {
              status: {
                in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED],
              },
            },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: {
              id: true,
              riderId: true,
              paymentType: true,
              cashDiscountBps: true,
            },
          },
        },
      }),
    ]);
    mark("after profile/gate/ride");

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

    if (!gate.ok) {
      return res.status(403).json({
        ok: false,
        error: gate.error || "Membership required.",
      });
    }

    if (!ride) {
      return res.status(404).json({
        ok: false,
        error: "Ride not found for this driver.",
      });
    }

    if (ride.status === RideStatus.COMPLETED) {
      mark("already completed response");
      return res.status(200).json({
        ok: true,
        billing: {
          finalFareCents: ride.totalPriceCents ?? 0,
          collectedAmountCents: 0,
          outstandingAmountCents: 0,
          note: "Ride was already completed.",
        },
      });
    }

    if (ride.status !== RideStatus.ACCEPTED && ride.status !== RideStatus.IN_ROUTE) {
      return res.status(400).json({
        ok: false,
        error: `Ride must be in ACCEPTED or IN_ROUTE to complete (current: ${ride.status}).`,
      });
    }

    const booking = ride.bookings[0] ?? null;

    if (!booking) {
      return res.status(400).json({
        ok: false,
        error: "No booking found for this ride.",
      });
    }

    const riderId = typeof booking.riderId === "string" ? booking.riderId : "";

    if (!riderId) {
      return res.status(400).json({
        ok: false,
        error: "Missing riderId on booking.",
      });
    }

    let finalDistanceMiles: number | null | undefined = null;

    if (isPositiveNumber(body.distanceMiles)) {
      finalDistanceMiles = body.distanceMiles;
    } else if (isPositiveNumber(ride.distanceMiles)) {
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

    const providedFareCents = clampInt(body.fareCents);
    const existingRideFareCents = clampInt(ride.totalPriceCents);

    const finalFareCents =
      providedFareCents && providedFareCents >= 50
        ? providedFareCents
        : existingRideFareCents && existingRideFareCents >= 50
          ? existingRideFareCents
          : null;

    if (!finalFareCents) {
      return res.status(400).json({
        ok: false,
        error: "Missing final fare amount.",
      });
    }

    const completionTime = new Date();
    const paymentType = (booking.paymentType ?? PaymentType.CARD) as PaymentType;

    if (paymentType === PaymentType.CASH) {
      mark("before cash receipt");
      const receipt = computeReceipt(finalFareCents, booking.cashDiscountBps ?? 0);
      mark("after cash receipt");

      mark("before cash transaction");
      await prisma.$transaction([
        prisma.ride.update({
          where: { id: ride.id },
          data: {
            status: RideStatus.COMPLETED,
            tripCompletedAt: completionTime,
            distanceMiles: finalDistanceMiles ?? undefined,
            totalPriceCents: receipt.finalAmountCents,
          },
        }),

        prisma.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.COMPLETED,
            paymentType: PaymentType.CASH,
            currency: "USD",
            baseAmountCents: receipt.baseAmountCents,
            discountCents: receipt.discountCents,
            finalAmountCents: receipt.finalAmountCents,
            cashNotPaidNote: body.note?.trim() || null,
          } as any,
        }),
      ]);
      mark("after cash transaction");

      // Do not block the API response on the secondary accounting rows.
      void upsertCashPaymentAndTransaction({
        rideId: ride.id,
        riderId,
        driverId,
        baseAmountCents: receipt.baseAmountCents,
        discountCents: receipt.discountCents,
        finalAmountCents: receipt.finalAmountCents,
      }).catch((err) => {
        console.error("[complete-ride] cash side effect failed:", err);
      });

      mark("before cash response");

      return res.status(200).json({
        ok: true,
        payment: {
          method: "CASH",
          amountCents: receipt.finalAmountCents,
        },
        billing: {
          finalFareCents: receipt.finalAmountCents,
          collectedAmountCents: receipt.finalAmountCents,
          outstandingAmountCents: 0,
        },
      });
    }

    mark("before card receipt");
    const cardReceipt = computeReceipt(finalFareCents, 0);
    const tipEligibleUntil = new Date(Date.now() + TIP_WINDOW_MS);
    mark("after card receipt");

    mark("before authorized lookup");
    const authorized = await prisma.ridePayment.findFirst({
      where: {
        rideId: ride.id,
        paymentType: PaymentType.CARD,
        stripePaymentIntentId: { not: null },
        capturedAt: null,
        status: {
          in: [RidePaymentStatus.AUTHORIZED, RidePaymentStatus.PENDING],
        },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    mark("after authorized lookup");

    mark("before card transaction");
    await prisma.$transaction([
      prisma.ride.update({
        where: { id: ride.id },
        data: {
          status: RideStatus.COMPLETED,
          tripCompletedAt: completionTime,
          distanceMiles: finalDistanceMiles ?? undefined,
          totalPriceCents: cardReceipt.finalAmountCents,
        },
      }),

      prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.COMPLETED,
          paymentType: PaymentType.CARD,
          cashDiscountBps: 0,
          currency: "USD",
          baseAmountCents: cardReceipt.baseAmountCents,
          discountCents: cardReceipt.discountCents,
          finalAmountCents: cardReceipt.finalAmountCents,
        } as any,
      }),

      ...(authorized?.id
        ? [
            prisma.ridePayment.update({
              where: { id: authorized.id },
              data: {
                baseAmountCents: cardReceipt.baseAmountCents,
                discountCents: cardReceipt.discountCents,
                finalAmountCents: cardReceipt.finalAmountCents,
                tipStatus: TipStatus.ELIGIBLE,
                tipAmountCents: 0,
                tipPercent: null,
                tipSelectedAt: null,
                tipChargedAt: null,
                tipSkippedAt: null,
                stripeTipChargeId: null,
                tipEligibleUntil,
              } as any,
            }),
          ]
        : []),
    ]);
    mark("after card transaction");

    mark("before card response");

    return res.status(200).json({
      ok: true,
      payment: {
        method: "CARD",
        amountCents: 0,
        stripeStatus: authorized?.id
          ? "awaiting_tip_selection_or_timeout"
          : "authorization_missing",
      },
      billing: {
        finalFareCents: cardReceipt.finalAmountCents,
        collectedAmountCents: 0,
        outstandingAmountCents: cardReceipt.finalAmountCents,
        note: authorized?.id
          ? "Ride completed. Final capture will happen after tip selection or tip-window timeout."
          : "Ride completed, but no prior authorization was found. Final charge fallback will be required.",
      },
    });
  } catch (err) {
    const msg = asMessage(err);
    console.error("Error completing ride:", err);
    return res.status(500).json({
      ok: false,
      error: msg || "Failed to complete ride.",
    });
  }
}