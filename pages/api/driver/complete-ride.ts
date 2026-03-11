// pages/api/driver/complete-ride.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import {
  RideStatus,
  BookingStatus,
  UserRole,
  PaymentType,
  RidePaymentStatus,
  TransactionStatus,
} from "@prisma/client";
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
      transaction?: {
        grossAmountCents: number;
        serviceFeeCents: number;
        netAmountCents: number;
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

const PLATFORM_FEE_BPS = 1000; // 10%

async function sendRideReceiptEmailSafe(_args: any) {
  return;
}

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
  const base = Math.max(0, Math.round(baseCents));
  const bps = clampCashDiscountBps(cashDiscountBps);
  const discountCents = bps > 0 ? Math.round(base * (bps / 10000)) : 0;
  const finalAmountCents = Math.max(0, base - discountCents);

  return { baseAmountCents: base, discountCents, finalAmountCents };
}

function computeDriverSplit(collectedAmountCents: number) {
  const grossAmountCents = Math.max(0, Math.round(collectedAmountCents));
  const serviceFeeCents = Math.round(grossAmountCents * (PLATFORM_FEE_BPS / 10000));
  const netAmountCents = Math.max(0, grossAmountCents - serviceFeeCents);

  return { grossAmountCents, serviceFeeCents, netAmountCents };
}

function restoreUndiscountedAmount(discountedAmountCents: number, cashDiscountBps: number) {
  const discounted = Math.max(0, Math.round(discountedAmountCents));
  const bps = clampCashDiscountBps(cashDiscountBps);

  if (bps <= 0) return discounted;

  const multiplier = (10000 - bps) / 10000;
  if (multiplier <= 0) return discounted;

  return Math.max(0, Math.round(discounted / multiplier));
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
      brand: true,
      last4: true,
      expMonth: true,
      expYear: true,
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

async function chargeSavedCardOffSession(args: {
  riderId: string;
  amountCents: number;
  metadata: Record<string, string>;
}) {
  const pm = await getDefaultPaymentMethodForUser(args.riderId);
  if (!pm?.customerId || !pm.stripePaymentMethodId) {
    return {
      ok: false as const,
      error: "No default backup card found for rider.",
    };
  }

  const pi = await stripe.paymentIntents.create({
    amount: args.amountCents,
    currency: "usd",
    customer: pm.customerId,
    payment_method: pm.stripePaymentMethodId,
    confirm: true,
    off_session: true,
    metadata: args.metadata,
  });

  if (pi.status !== "succeeded") {
    return {
      ok: false as const,
      error: `Backup card charge did not succeed (status: ${pi.status}).`,
      stripeStatus: pi.status,
      paymentIntentId: pi.id,
      latestChargeId:
        typeof pi.latest_charge === "string"
          ? pi.latest_charge
          : (pi.latest_charge as any)?.id ?? null,
      paymentMethodId: pm.paymentMethodId,
    };
  }

  return {
    ok: true as const,
    stripeStatus: pi.status,
    paymentIntentId: pi.id,
    latestChargeId:
      typeof pi.latest_charge === "string"
        ? pi.latest_charge
        : (pi.latest_charge as any)?.id ?? null,
    paymentMethodId: pm.paymentMethodId,
  };
}

async function captureAuthorizedCardPayment(args: {
  rideId: string;
  amountToCaptureCents: number;
}) {
  const rp = await prisma.ridePayment.findFirst({
    where: {
      rideId: args.rideId,
      stripePaymentIntentId: { not: null },
      capturedAt: null,
      status: { in: [RidePaymentStatus.AUTHORIZED, RidePaymentStatus.PENDING] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      riderId: true,
      paymentMethodId: true,
      amountCents: true,
      stripePaymentIntentId: true,
    },
  });

  if (!rp?.stripePaymentIntentId) {
    return {
      ok: false as const,
      error: "No authorized payment found for this ride.",
    };
  }

  if (args.amountToCaptureCents > rp.amountCents) {
    return {
      ok: false as const,
      error: "Final fare exceeds authorized amount.",
    };
  }

  const pi = await stripe.paymentIntents.capture(rp.stripePaymentIntentId, {
    amount_to_capture: args.amountToCaptureCents,
  });

  const succeeded = pi.status === "succeeded";

  await prisma.ridePayment.update({
    where: { id: rp.id },
    data: {
      status: succeeded ? RidePaymentStatus.SUCCEEDED : RidePaymentStatus.PENDING,
      capturedAt: succeeded ? new Date() : null,
      finalAmountCents: args.amountToCaptureCents,
    } as any,
  });

  if (!succeeded) {
    return {
      ok: false as const,
      error: `Stripe capture did not succeed (status: ${pi.status}).`,
      stripeStatus: pi.status,
    };
  }

  return {
    ok: true as const,
    stripeStatus: pi.status,
    ridePaymentId: rp.id,
    paymentMethodId: rp.paymentMethodId ?? null,
  };
}

async function writeCashRidePayment(args: {
  rideId: string;
  riderId: string;
  amountCents: number;
  baseAmountCents: number;
  discountCents: number;
  finalAmountCents: number;
}) {
  const key = `cash_complete:${args.rideId}:${args.riderId}`;

  const existing = await prisma.ridePayment.findFirst({
    where: { idempotencyKey: key },
    select: { id: true },
  });

  if (existing) {
    return prisma.ridePayment.update({
      where: { id: existing.id },
      data: {
        amountCents: args.amountCents,
        currency: "usd",
        status: RidePaymentStatus.SUCCEEDED,
        provider: "CASH",
        paymentType: PaymentType.CASH,
        baseAmountCents: args.baseAmountCents,
        discountCents: args.discountCents,
        finalAmountCents: args.finalAmountCents,
        capturedAt: new Date(),
      } as any,
      select: { id: true },
    });
  }

  return prisma.ridePayment.create({
    data: {
      rideId: args.rideId,
      riderId: args.riderId,
      amountCents: args.amountCents,
      currency: "usd",
      status: RidePaymentStatus.SUCCEEDED,
      provider: "CASH",
      paymentType: PaymentType.CASH,
      baseAmountCents: args.baseAmountCents,
      discountCents: args.discountCents,
      finalAmountCents: args.finalAmountCents,
      capturedAt: new Date(),
      idempotencyKey: key,
    } as any,
    select: { id: true },
  });
}

async function writeFallbackCardRidePayment(args: {
  rideId: string;
  riderId: string;
  paymentMethodId: string | null;
  amountCents: number;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
}) {
  const key = `fallback_card:${args.rideId}:${args.riderId}`;

  const existing = await prisma.ridePayment.findFirst({
    where: { idempotencyKey: key },
    select: { id: true },
  });

  if (existing) {
    return prisma.ridePayment.update({
      where: { id: existing.id },
      data: {
        amountCents: args.amountCents,
        currency: "usd",
        status: RidePaymentStatus.SUCCEEDED,
        provider: "STRIPE",
        paymentType: PaymentType.CARD,
        baseAmountCents: args.amountCents,
        discountCents: 0,
        finalAmountCents: args.amountCents,
        capturedAt: new Date(),
        paymentMethodId: args.paymentMethodId,
        stripePaymentIntentId: args.stripePaymentIntentId,
        stripeChargeId: args.stripeChargeId,
      } as any,
      select: { id: true },
    });
  }

  return prisma.ridePayment.create({
    data: {
      rideId: args.rideId,
      riderId: args.riderId,
      amountCents: args.amountCents,
      currency: "usd",
      status: RidePaymentStatus.SUCCEEDED,
      provider: "STRIPE",
      paymentType: PaymentType.CARD,
      baseAmountCents: args.amountCents,
      discountCents: 0,
      finalAmountCents: args.amountCents,
      capturedAt: new Date(),
      paymentMethodId: args.paymentMethodId,
      stripePaymentIntentId: args.stripePaymentIntentId,
      stripeChargeId: args.stripeChargeId,
      idempotencyKey: key,
    } as any,
    select: { id: true },
  });
}

async function upsertTransactionForRide(args: {
  rideId: string;
  driverId: string;
  collectedAmountCents: number;
}) {
  const split = computeDriverSplit(args.collectedAmountCents);

  const existing = await prisma.transaction.findFirst({
    where: { rideId: args.rideId, driverId: args.driverId },
    select: { id: true },
  });

  if (existing) {
    return prisma.transaction.update({
      where: { id: existing.id },
      data: {
        grossAmountCents: split.grossAmountCents,
        serviceFeeCents: split.serviceFeeCents,
        netAmountCents: split.netAmountCents,
        status: TransactionStatus.COMPLETED,
      },
      select: {
        grossAmountCents: true,
        serviceFeeCents: true,
        netAmountCents: true,
      },
    });
  }

  return prisma.transaction.create({
    data: {
      rideId: args.rideId,
      driverId: args.driverId,
      grossAmountCents: split.grossAmountCents,
      serviceFeeCents: split.serviceFeeCents,
      netAmountCents: split.netAmountCents,
      status: TransactionStatus.COMPLETED,
    },
    select: {
      grossAmountCents: true,
      serviceFeeCents: true,
      netAmountCents: true,
    },
  });
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
      return res.status(403).json({ ok: false, error: "Only drivers can complete rides." });
    }

    const driverId = String(user.id);

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

    const body = (req.body ?? {}) as CompleteRideBody;
    const rideId = typeof body.rideId === "string" ? body.rideId.trim() : "";

    if (!rideId) {
      return res.status(400).json({ ok: false, error: "rideId is required" });
    }

    const ride = await prisma.ride.findFirst({
      where: { id: rideId, driverId },
      include: {
        bookings: {
          where: { status: { in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED] } },
          orderBy: { createdAt: "asc" },
          take: 1,
          include: { rider: true },
        },
        driver: true,
      },
    });

    if (!ride) {
      return res.status(404).json({ ok: false, error: "Ride not found for this driver." });
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
    if (!booking) {
      return res.status(400).json({ ok: false, error: "No booking found for this ride." });
    }

    const riderId = booking.riderId ? String(booking.riderId) : "";
    if (!riderId) {
      return res.status(400).json({ ok: false, error: "Missing riderId on booking." });
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
      return res.status(400).json({ ok: false, error: "Missing final fare amount." });
    }

    const completionTime = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.ride.update({
        where: { id: ride.id },
        data: {
          status: RideStatus.COMPLETED,
          tripCompletedAt: completionTime,
          distanceMiles: finalDistanceMiles ?? undefined,
          totalPriceCents: finalFareCents,
        },
      });

      await tx.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.COMPLETED },
      });
    });

    const paymentType = (booking.paymentType ?? PaymentType.CARD) as PaymentType;

    if (paymentType === PaymentType.CASH && body.unpaid === true) {
      const originalCashDiscountBps = clampCashDiscountBps(
        (booking as any).originalCashDiscountBps ??
          (booking as any).cashDiscountBps ??
          0
      );

      const existingBaseAmountCents =
        typeof (booking as any).baseAmountCents === "number" && (booking as any).baseAmountCents > 0
          ? Math.round((booking as any).baseAmountCents)
          : 0;

      const restoredBaseFromDiscount = restoreUndiscountedAmount(
        finalFareCents,
        originalCashDiscountBps
      );

      const correctedBaseAmountCents = Math.max(
        finalFareCents,
        existingBaseAmountCents,
        restoredBaseFromDiscount
      );

      const receipt = computeReceipt(correctedBaseAmountCents, 0);

      const charge = await chargeSavedCardOffSession({
        riderId,
        amountCents: receipt.finalAmountCents,
        metadata: {
          kind: "cash_unpaid_fallback",
          rideId: ride.id,
          riderId,
          driverId,
        },
      });

      if (!charge.ok) {
        return res.status(402).json({
          ok: false,
          error: charge.error || "Backup card charge failed.",
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.ride.update({
          where: { id: ride.id },
          data: {
            totalPriceCents: receipt.finalAmountCents,
          },
        });

        await tx.booking.update({
          where: { id: booking.id },
          data: {
            paymentType: PaymentType.CARD,
            cashDiscountBps: 0,
            currency: "USD",
            baseAmountCents: receipt.baseAmountCents,
            discountCents: receipt.discountCents,
            finalAmountCents: receipt.finalAmountCents,
            cashNotPaidAt: completionTime,
            cashNotPaidReportedById: driverId,
            cashNotPaidNote: body.note?.trim() || null,
            cashDiscountRevokedAt: completionTime,
            cashDiscountRevokedReason: "Driver reported unpaid cash (RIDER_REFUSED_CASH)",
            fallbackCardChargedAt: completionTime,
          } as any,
        });
      });

      await writeFallbackCardRidePayment({
        rideId: ride.id,
        riderId,
        paymentMethodId: charge.paymentMethodId ?? null,
        amountCents: receipt.finalAmountCents,
        stripePaymentIntentId: charge.paymentIntentId ?? null,
        stripeChargeId: charge.latestChargeId ?? null,
      });

      const transaction = await upsertTransactionForRide({
        rideId: ride.id,
        driverId,
        collectedAmountCents: receipt.finalAmountCents,
      });

      res.status(200).json({
        ok: true,
        payment: {
          method: "CARD",
          amountCents: receipt.finalAmountCents,
          stripeStatus: charge.stripeStatus,
        },
        transaction,
      });

      if (booking.rider?.email) {
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
            totalPriceCents: receipt.finalAmountCents,
          },
        }).catch((err) => {
          console.error("[receipt-email] Failed:", err);
        });
      }

      return;
    }

    if (paymentType === PaymentType.CASH) {
      const bps =
        typeof (booking as any).cashDiscountBps === "number"
          ? (booking as any).cashDiscountBps
          : 0;

      const receipt = computeReceipt(finalFareCents, bps);

      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          paymentType: PaymentType.CASH,
          currency: "USD",
          baseAmountCents: receipt.baseAmountCents,
          discountCents: receipt.discountCents,
          finalAmountCents: receipt.finalAmountCents,
          cashNotPaidNote: body.note?.trim() || null,
        } as any,
      });

      await writeCashRidePayment({
        rideId: ride.id,
        riderId,
        amountCents: receipt.finalAmountCents,
        baseAmountCents: receipt.baseAmountCents,
        discountCents: receipt.discountCents,
        finalAmountCents: receipt.finalAmountCents,
      });

      const transaction = await upsertTransactionForRide({
        rideId: ride.id,
        driverId,
        collectedAmountCents: receipt.finalAmountCents,
      });

      res.status(200).json({
        ok: true,
        payment: {
          method: "CASH",
          amountCents: receipt.finalAmountCents,
        },
        transaction,
      });

      if (booking.rider?.email) {
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
            totalPriceCents: receipt.finalAmountCents,
          },
        }).catch((err) => {
          console.error("[receipt-email] Failed:", err);
        });
      }

      return;
    }

    const capture = await captureAuthorizedCardPayment({
      rideId: ride.id,
      amountToCaptureCents: finalFareCents,
    });

    if (!capture.ok) {
      return res.status(402).json({
        ok: false,
        error: capture.error || "Card capture failed.",
      });
    }

    const cardReceipt = computeReceipt(finalFareCents, 0);

    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        paymentType: PaymentType.CARD,
        cashDiscountBps: 0,
        currency: "USD",
        baseAmountCents: cardReceipt.baseAmountCents,
        discountCents: cardReceipt.discountCents,
        finalAmountCents: cardReceipt.finalAmountCents,
      } as any,
    });

    const transaction = await upsertTransactionForRide({
      rideId: ride.id,
      driverId,
      collectedAmountCents: cardReceipt.finalAmountCents,
    });

    res.status(200).json({
      ok: true,
      payment: {
        method: "CARD",
        amountCents: cardReceipt.finalAmountCents,
        stripeStatus: capture.stripeStatus,
      },
      transaction,
    });

    if (booking.rider?.email) {
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
          totalPriceCents: cardReceipt.finalAmountCents,
        },
      }).catch((err) => {
        console.error("[receipt-email] Failed:", err);
      });
    }

    return;
  } catch (err) {
    const msg = asMessage(err);
    console.error("Error completing ride:", err);
    return res.status(500).json({ ok: false, error: msg || "Failed to complete ride." });
  }
}