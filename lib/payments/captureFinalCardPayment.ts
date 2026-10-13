// lib/payments/captureFinalCardPayment.ts

import {
  PaymentType,
  RidePaymentStatus,
  TipStatus,
  TransactionStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

const PLATFORM_FEE_BPS = 1000;

export type CaptureFinalSuccess = {
  ok: true;
  capturedAmountCents: number;
  finalFareCents: number;
  tipAmountCents: number;
  totalAmountCents: number;
  stripeStatus: string;
};

export type CaptureFinalFailure = {
  ok: false;
  status: number;
  error: string;
  needsFallbackCharge?: boolean;
  authorizedAmountCents?: number;
  finalFareCents?: number;
  tipAmountCents?: number;
  totalAmountCents?: number;
  shortfallCents?: number;
};

export type CaptureFinalResult =
  | CaptureFinalSuccess
  | CaptureFinalFailure;

function safeNonNegativeInt(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? Math.round(value)
    : 0;
}

function computeDriverSplit(args: {
  baseFareCents: number;
  tipAmountCents: number;
}) {
  const baseFareCents = Math.max(0, Math.round(args.baseFareCents));
  const tipAmountCents = Math.max(0, Math.round(args.tipAmountCents));

  const serviceFeeCents = Math.round(
    baseFareCents * (PLATFORM_FEE_BPS / 10000)
  );

  const grossAmountCents = baseFareCents + tipAmountCents;

  const netAmountCents = Math.max(
    0,
    baseFareCents - serviceFeeCents + tipAmountCents
  );

  return {
    grossAmountCents,
    serviceFeeCents,
    netAmountCents,
  };
}

async function upsertTransactionForRide(args: {
  rideId: string;
  driverId: string;
  baseFareCents: number;
  tipAmountCents: number;
}) {
  const split = computeDriverSplit({
    baseFareCents: args.baseFareCents,
    tipAmountCents: args.tipAmountCents,
  });

  const existing = await prisma.transaction.findFirst({
    where: {
      rideId: args.rideId,
      driverId: args.driverId,
    },
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
  });
}

export async function captureFinalCardPayment(args: {
  riderId: string;
  rideId: string;
}): Promise<CaptureFinalResult> {
  const riderId = args.riderId.trim();
  const rideId = args.rideId.trim();

  if (!riderId) {
    return {
      ok: false,
      status: 401,
      error: "Not authenticated",
    };
  }

  if (!rideId) {
    return {
      ok: false,
      status: 400,
      error: "Invalid rideId",
    };
  }

  try {
    const payment = await prisma.ridePayment.findFirst({
      where: {
        rideId,
        riderId,
        paymentType: PaymentType.CARD,
        stripePaymentIntentId: { not: null },
        capturedAt: null,
        status: {
          in: [
            RidePaymentStatus.AUTHORIZED,
            RidePaymentStatus.PENDING,
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        rideId: true,
        riderId: true,
        amountCents: true,
        stripePaymentIntentId: true,
        finalAmountCents: true,
        tipAmountCents: true,
        tipStatus: true,
        ride: {
          select: {
            driverId: true,
          },
        },
      },
    });

    if (!payment?.stripePaymentIntentId) {
      return {
        ok: false,
        status: 404,
        error: "Authorized payment not found",
      };
    }

    const finalFareCents = safeNonNegativeInt(
      payment.finalAmountCents
    );

    const tipAmountCents =
      payment.tipStatus === TipStatus.PENDING
        ? safeNonNegativeInt(payment.tipAmountCents)
        : 0;

    const totalAmountCents =
      finalFareCents + tipAmountCents;

    if (totalAmountCents <= 0) {
      return {
        ok: false,
        status: 400,
        error: "Nothing to capture",
      };
    }

    if (totalAmountCents > payment.amountCents) {
      return {
        ok: false,
        status: 409,
        error: "Final total exceeds authorized amount.",
        needsFallbackCharge: true,
        authorizedAmountCents: payment.amountCents,
        finalFareCents,
        tipAmountCents,
        totalAmountCents,
        shortfallCents:
          totalAmountCents - payment.amountCents,
      };
    }

    const pi = await stripe.paymentIntents.capture(
      payment.stripePaymentIntentId,
      {
        amount_to_capture: totalAmountCents,
      }
    );

    if (pi.status !== "succeeded") {
      return {
        ok: false,
        status: 400,
        error: `Capture did not succeed (status: ${pi.status})`,
      };
    }

    const capturedAt = new Date();

    await prisma.ridePayment.update({
      where: { id: payment.id },
      data: {
        status: RidePaymentStatus.SUCCEEDED,
        capturedAt,
        finalAmountCents: totalAmountCents,
        tipStatus:
          payment.tipStatus === TipStatus.PENDING
            ? TipStatus.SUCCEEDED
            : payment.tipStatus,
        tipChargedAt:
          payment.tipStatus === TipStatus.PENDING &&
          tipAmountCents > 0
            ? capturedAt
            : null,
        stripeChargeId:
          typeof pi.latest_charge === "string"
            ? pi.latest_charge
            : pi.latest_charge?.id ?? null,
      } as any,
    });

    if (payment.ride?.driverId) {
      await upsertTransactionForRide({
        rideId: payment.rideId,
        driverId: payment.ride.driverId,
        baseFareCents: finalFareCents,
        tipAmountCents,
      });
    }

    return {
      ok: true,
      capturedAmountCents: totalAmountCents,
      finalFareCents,
      tipAmountCents,
      totalAmountCents,
      stripeStatus: pi.status,
    };
  } catch (err) {
    console.error("Final capture error:", err);

    return {
      ok: false,
      status: 500,
      error: "Failed to capture final amount",
    };
  }
}