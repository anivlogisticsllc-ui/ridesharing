// pages/api/rider/capture-final.ts

import type {
  NextApiRequest,
  NextApiResponse,
} from "next";
import { getServerSession } from "next-auth";
import {
  PaymentType,
  RidePaymentStatus,
  TipStatus,
  TransactionStatus,
} from "@prisma/client";

import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

type ApiResponse =
  | {
      ok: true;
      capturedAmountCents: number;
      finalFareCents: number;
      tipAmountCents: number;
      totalAmountCents: number;
      stripeStatus: string;
    }
  | {
      ok: false;
      error: string;
      needsFallbackCharge?: boolean;
      authorizedAmountCents?: number;
      finalFareCents?: number;
      tipAmountCents?: number;
      totalAmountCents?: number;
      shortfallCents?: number;
    };

type RequestBody = {
  rideId?: string;
};

const PLATFORM_FEE_BPS = 1000; // 10%

function safeNonNegativeInt(
  value: unknown
): number {
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
  const baseFareCents =
    Math.max(
      0,
      Math.round(
        args.baseFareCents
      )
    );

  const tipAmountCents =
    Math.max(
      0,
      Math.round(
        args.tipAmountCents
      )
    );

  const serviceFeeCents =
    Math.round(
      baseFareCents *
        (PLATFORM_FEE_BPS /
          10000)
    );

  const grossAmountCents =
    baseFareCents +
    tipAmountCents;

  const netAmountCents =
    Math.max(
      0,
      baseFareCents -
        serviceFeeCents +
        tipAmountCents
    );

  return {
    grossAmountCents,
    serviceFeeCents,
    netAmountCents,
  };
}

async function upsertTransactionForRide(
  args: {
    rideId: string;
    driverId: string;
    baseFareCents: number;
    tipAmountCents: number;
  }
) {
  const split =
    computeDriverSplit({
      baseFareCents:
        args.baseFareCents,
      tipAmountCents:
        args.tipAmountCents,
    });

  const existing =
    await prisma.transaction.findFirst({
      where: {
        rideId: args.rideId,
        driverId:
          args.driverId,
      },
      select: {
        id: true,
      },
    });

  if (existing) {
    return prisma.transaction.update({
      where: {
        id: existing.id,
      },
      data: {
        grossAmountCents:
          split.grossAmountCents,
        serviceFeeCents:
          split.serviceFeeCents,
        netAmountCents:
          split.netAmountCents,
        status:
          TransactionStatus.COMPLETED,
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
      driverId:
        args.driverId,
      grossAmountCents:
        split.grossAmountCents,
      serviceFeeCents:
        split.serviceFeeCents,
      netAmountCents:
        split.netAmountCents,
      status:
        TransactionStatus.COMPLETED,
    },
    select: {
      grossAmountCents: true,
      serviceFeeCents: true,
      netAmountCents: true,
    },
  });
}

function getStripeErrorCode(
  err: unknown
): string | null {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (
      err as {
        code?: unknown;
      }
    ).code === "string"
  ) {
    return (
      err as {
        code: string;
      }
    ).code;
  }

  return null;
}

function getStripeErrorMessage(
  err: unknown
): string | null {
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (
      err as {
        message?: unknown;
      }
    ).message === "string"
  ) {
    return (
      err as {
        message: string;
      }
    ).message;
  }

  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "POST") {
    res.setHeader(
      "Allow",
      "POST"
    );

    return res
      .status(405)
      .json({
        ok: false,
        error:
          "Method not allowed",
      });
  }

  const session =
    await getServerSession(
      req,
      res,
      authOptions
    );

  const riderId =
    typeof (
      session?.user as
        | {
            id?: unknown;
          }
        | undefined
    )?.id === "string"
      ? (
          session?.user as {
            id: string;
          }
        ).id
      : null;

  if (!riderId) {
    return res
      .status(401)
      .json({
        ok: false,
        error:
          "Not authenticated",
      });
  }

  const { rideId } =
    (req.body ??
      {}) as RequestBody;

  if (
    typeof rideId !==
      "string" ||
    !rideId.trim()
  ) {
    return res
      .status(400)
      .json({
        ok: false,
        error:
          "Invalid rideId",
      });
  }

  try {
    const payment =
      await prisma.ridePayment.findFirst({
        where: {
          rideId,
          riderId,
          paymentType:
            PaymentType.CARD,
          stripePaymentIntentId:
            {
              not: null,
            },
          capturedAt: null,
          status: {
            in: [
              RidePaymentStatus.AUTHORIZED,
              RidePaymentStatus.PENDING,
            ],
          },
        },
        orderBy: {
          createdAt: "desc",
        },
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

    if (
      !payment?.stripePaymentIntentId
    ) {
      return res
        .status(404)
        .json({
          ok: false,
          error:
            "Authorized payment not found",
        });
    }

    const finalFareCents =
      safeNonNegativeInt(
        payment.finalAmountCents
      );

    const tipAmountCents =
      payment.tipStatus ===
      TipStatus.PENDING
        ? safeNonNegativeInt(
            payment.tipAmountCents
          )
        : 0;

    const totalAmountCents =
      finalFareCents +
      tipAmountCents;

    if (
      totalAmountCents <= 0
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          error:
            "Nothing to capture",
        });
    }

    if (
      totalAmountCents >
      payment.amountCents
    ) {
      return res
        .status(409)
        .json({
          ok: false,
          error:
            "Final total exceeds authorized amount.",
          needsFallbackCharge:
            true,
          authorizedAmountCents:
            payment.amountCents,
          finalFareCents,
          tipAmountCents,
          totalAmountCents,
          shortfallCents:
            totalAmountCents -
            payment.amountCents,
        });
    }

    /*
     * Normal path uses ONE Stripe call.
     * If an unusually old authorization expired or was canceled,
     * Stripe rejects capture and we return a controlled recovery response.
     */
    let pi;

    try {
      pi =
        await stripe.paymentIntents.capture(
          payment.stripePaymentIntentId,
          {
            amount_to_capture:
              totalAmountCents,
          }
        );
    } catch (err) {
      const stripeCode =
        getStripeErrorCode(
          err
        );

      const stripeMessage =
        getStripeErrorMessage(
          err
        );

      if (
        stripeCode ===
          "payment_intent_unexpected_state" ||
        stripeMessage
          ?.toLowerCase()
          .includes(
            "could not be captured"
          ) ||
        stripeMessage
          ?.toLowerCase()
          .includes("canceled")
      ) {
        console.error(
          "[capture-final] Stripe authorization is no longer capturable:",
          err
        );

        return res
          .status(409)
          .json({
            ok: false,
            error:
              "Card authorization is no longer available for capture.",
            needsFallbackCharge:
              true,
            authorizedAmountCents:
              payment.amountCents,
            finalFareCents,
            tipAmountCents,
            totalAmountCents,
          });
      }

      throw err;
    }

    if (
      pi.status !==
      "succeeded"
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          error: `Capture did not succeed (status: ${pi.status})`,
        });
    }

    const capturedAt =
      new Date();

    await prisma.ridePayment.update({
      where: {
        id: payment.id,
      },
      data: {
        status:
          RidePaymentStatus.SUCCEEDED,
        capturedAt,
        finalAmountCents:
          totalAmountCents,

        tipStatus:
          payment.tipStatus ===
          TipStatus.PENDING
            ? TipStatus.SUCCEEDED
            : payment.tipStatus,

        tipChargedAt:
          payment.tipStatus ===
            TipStatus.PENDING &&
          tipAmountCents > 0
            ? capturedAt
            : null,

        stripeChargeId:
          typeof pi.latest_charge ===
          "string"
            ? pi.latest_charge
            : pi.latest_charge
                ?.id ?? null,
      } as any,
    });

    if (
      payment.ride?.driverId
    ) {
      await upsertTransactionForRide({
        rideId:
          payment.rideId,
        driverId:
          payment.ride
            .driverId,
        baseFareCents:
          finalFareCents,
        tipAmountCents,
      });
    }

    return res
      .status(200)
      .json({
        ok: true,
        capturedAmountCents:
          totalAmountCents,
        finalFareCents,
        tipAmountCents,
        totalAmountCents,
        stripeStatus:
          pi.status,
      });
  } catch (err) {
    console.error(
      "Final capture error:",
      err
    );

    return res
      .status(500)
      .json({
        ok: false,
        error:
          "Failed to capture final amount",
      });
  }
}