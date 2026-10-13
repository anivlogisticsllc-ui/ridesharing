// pages/api/driver/book-ride.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import {
  BookingStatus,
  PaymentType,
  RidePaymentStatus,
  RideStatus,
  UserRole,
} from "@prisma/client";

import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
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
  | {
      ok: false;
      error: string;
    };

type BookRideBody = {
  rideId?: string;
};

const AUTH_RECHECK_AFTER_MS = 4 * 24 * 60 * 60 * 1000;

function asMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown error";
}

function clampInt(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  if (!Number.isFinite(n)) return null;

  return Math.max(0, Math.round(n));
}

function getStripeErrorCode(err: unknown): string | null {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string"
  ) {
    return (err as { code: string }).code;
  }

  return null;
}

async function getDefaultPaymentMethodForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      stripeCustomerId: true,
      stripeDefaultPaymentId: true,
    },
  });

  if (!user?.stripeCustomerId) {
    return null;
  }

  const dbPm = await prisma.paymentMethod.findFirst({
    where: {
      userId,
      isDefault: true,
      stripePaymentMethodId: {
        not: null,
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
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

    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  try {
    const session = await getServerSession(
      req,
      res,
      authOptions
    );

    const user = session?.user as
      | {
          id?: string;
          role?: UserRole | string;
        }
      | undefined;

    const driverId =
      typeof user?.id === "string"
        ? user.id
        : undefined;

    if (!driverId) {
      return res.status(401).json({
        ok: false,
        error: "Not authenticated",
      });
    }

    if (user?.role !== UserRole.DRIVER) {
      return res.status(403).json({
        ok: false,
        error: "Only drivers can book rides.",
      });
    }

    const profile =
      await prisma.driverProfile.findUnique({
        where: {
          userId: driverId,
        },
        select: {
          verificationStatus: true,
        },
      });

    if (!profile) {
      return res.status(403).json({
        ok: false,
        error:
          "Driver profile missing. Complete driver setup first.",
      });
    }

    if (
      profile.verificationStatus !==
      "APPROVED"
    ) {
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
        error:
          gate.error ||
          "Membership required.",
      });
    }

    const body =
      (req.body ?? {}) as BookRideBody;

    const rideId =
      typeof body.rideId === "string"
        ? body.rideId.trim()
        : "";

    if (!rideId) {
      return res.status(400).json({
        ok: false,
        error: "rideId is required",
      });
    }

    const ride =
      await prisma.ride.findUnique({
        where: {
          id: rideId,
        },
        include: {
          bookings: {
            where: {
              status:
                BookingStatus.PENDING,
            },
            orderBy: {
              createdAt: "asc",
            },
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
      return res.status(404).json({
        ok: false,
        error: "Ride not found.",
      });
    }

    if (
      ride.driverId &&
      ride.driverId !== driverId
    ) {
      return res.status(409).json({
        ok: false,
        error:
          "Ride is already booked by another driver.",
      });
    }

    if (
      ride.status !== RideStatus.OPEN &&
      !(
        ride.status === RideStatus.ACCEPTED &&
        ride.driverId === driverId
      )
    ) {
      return res.status(400).json({
        ok: false,
        error: `Ride must be OPEN to be booked (current: ${ride.status}).`,
      });
    }

    const booking =
      ride.bookings[0] ?? null;

    if (!booking) {
      return res.status(400).json({
        ok: false,
        error:
          "No pending booking found for this ride.",
      });
    }

    const riderId =
      booking.riderId
        ? String(booking.riderId)
        : "";

    if (!riderId) {
      return res.status(400).json({
        ok: false,
        error:
          "Booking is missing riderId.",
      });
    }

    const paymentType =
      (booking.paymentType ??
        PaymentType.CARD) as PaymentType;

    const estimatedFareCents =
      clampInt(booking.finalAmountCents) ??
      clampInt(ride.totalPriceCents) ??
      0;

    if (estimatedFareCents < 50) {
      return res.status(400).json({
        ok: false,
        error:
          "Estimated fare is missing or too small to authorize.",
      });
    }

    let paymentResponse:
      | {
          method: "CARD" | "CASH";
          authorizedAmountCents?: number;
          stripeStatus?: string;
        }
      | undefined;

    if (
      paymentType === PaymentType.CARD
    ) {
      const existingAuthorized =
        await prisma.ridePayment.findFirst({
          where: {
            rideId: ride.id,
            riderId,
            stripePaymentIntentId: {
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
            amountCents: true,
            stripePaymentIntentId: true,
            createdAt: true,
          },
        });

      let canReuseExisting =
        Boolean(
          existingAuthorized?.stripePaymentIntentId
        );

      let reusableStripeStatus =
        "already_authorized";

      if (
        existingAuthorized?.stripePaymentIntentId
      ) {
        const authorizationAgeMs =
          Date.now() -
          existingAuthorized.createdAt.getTime();

        /*
         * Normal rides should complete well before this threshold.
         * Avoid an external Stripe lookup for fresh authorizations.
         * Only verify unusually old authorizations.
         */
        if (
          authorizationAgeMs >=
          AUTH_RECHECK_AFTER_MS
        ) {
          try {
            const existingPi =
              await stripe.paymentIntents.retrieve(
                existingAuthorized.stripePaymentIntentId
              );

            if (
              existingPi.status ===
              "requires_capture"
            ) {
              canReuseExisting = true;
              reusableStripeStatus =
                existingPi.status;
            } else {
              canReuseExisting = false;

              console.warn(
                `[book-ride] Existing PaymentIntent ${existingPi.id} is no longer capturable. Stripe status: ${existingPi.status}. Creating a fresh authorization.`
              );
            }
          } catch (err) {
            const stripeCode =
              getStripeErrorCode(err);

            if (
              stripeCode ===
              "resource_missing"
            ) {
              canReuseExisting = false;

              console.warn(
                "[book-ride] Existing Stripe PaymentIntent no longer exists. Creating a fresh authorization."
              );
            } else {
              console.error(
                "[book-ride] Failed to verify old PaymentIntent:",
                err
              );

              return res
                .status(502)
                .json({
                  ok: false,
                  error:
                    "Unable to verify the rider's existing card authorization.",
                });
            }
          }
        }
      }

      if (
        existingAuthorized &&
        canReuseExisting
      ) {
        paymentResponse = {
          method: "CARD",
          authorizedAmountCents:
            existingAuthorized.amountCents,
          stripeStatus:
            reusableStripeStatus,
        };
      } else {
        const pm =
          await getDefaultPaymentMethodForUser(
            riderId
          );

        if (
          !pm?.customerId ||
          !pm.stripePaymentMethodId
        ) {
          return res.status(402).json({
            ok: false,
            error:
              "Rider has no default card available for authorization.",
          });
        }

        const bufferCents =
          Math.round(
            estimatedFareCents * 0.2
          );

        const authorizedAmountCents =
          estimatedFareCents +
          bufferCents;

        const pi =
          await stripe.paymentIntents.create({
            amount:
              authorizedAmountCents,
            currency: "usd",
            customer: pm.customerId,
            payment_method:
              pm.stripePaymentMethodId,
            confirm: true,
            off_session: true,
            capture_method: "manual",
            metadata: {
              kind:
                "ride_authorization",
              rideId: ride.id,
              bookingId: booking.id,
              riderId,
              driverId,
            },
          });

        if (
          pi.status !==
          "requires_capture"
        ) {
          return res.status(402).json({
            ok: false,
            error: `Card authorization failed (status: ${pi.status}).`,
          });
        }

        if (existingAuthorized) {
          await prisma.ridePayment.update({
            where: {
              id: existingAuthorized.id,
            },
            data: {
              amountCents:
                authorizedAmountCents,
              currency: "usd",
              status:
                RidePaymentStatus.AUTHORIZED,
              provider: "STRIPE",
              paymentType:
                PaymentType.CARD,
              paymentMethodId:
                pm.paymentMethodId,
              stripePaymentIntentId:
                pi.id,
              capturedAt: null,
              baseAmountCents:
                estimatedFareCents,
              discountCents: 0,
              finalAmountCents:
                estimatedFareCents,
              stripeChargeId: null,
            } as any,
          });
        } else {
          await prisma.ridePayment.create({
            data: {
              rideId: ride.id,
              riderId,
              amountCents:
                authorizedAmountCents,
              currency: "usd",
              status:
                RidePaymentStatus.AUTHORIZED,
              provider: "STRIPE",
              paymentType:
                PaymentType.CARD,
              paymentMethodId:
                pm.paymentMethodId,
              stripePaymentIntentId:
                pi.id,
              baseAmountCents:
                estimatedFareCents,
              discountCents: 0,
              finalAmountCents:
                estimatedFareCents,
              idempotencyKey: `ride_auth:${ride.id}:${riderId}`,
            } as any,
          });
        }

        paymentResponse = {
          method: "CARD",
          authorizedAmountCents,
          stripeStatus: pi.status,
        };
      }
    } else {
      paymentResponse = {
        method: "CASH",
      };
    }

    /*
     * Only mark the ride ACCEPTED after CARD payment
     * preparation succeeds. CASH can proceed immediately.
     */
    await prisma.$transaction(
      async (tx) => {
        await tx.ride.update({
          where: {
            id: ride.id,
          },
          data: {
            driverId,
            status:
              RideStatus.ACCEPTED,
          },
        });

        await tx.booking.update({
          where: {
            id: booking.id,
          },
          data: {
            status:
              BookingStatus.ACCEPTED,
          },
        });
      }
    );

    return res.status(200).json({
      ok: true,
      rideId: ride.id,
      bookingId: booking.id,
      ...(paymentResponse
        ? {
            payment:
              paymentResponse,
          }
        : {}),
    });
  } catch (err) {
    console.error(
      "[book-ride] error:",
      err
    );

    return res.status(500).json({
      ok: false,
      error:
        asMessage(err) ||
        "Server error",
    });
  }
}