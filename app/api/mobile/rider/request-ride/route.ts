// app/api/mobile/rider/request-ride/route.ts

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import {
  BookingStatus,
  PaymentType,
  RideStatus,
  UserRole,
} from "@prisma/client";
import type Stripe from "stripe";

import { prisma } from "@/lib/prisma";
import {
  membershipErrorMessage,
  requireTrialOrActive,
} from "@/lib/guardMembership";
import { stripe } from "@/lib/stripe";

const JWT_SECRET = process.env.MOBILE_JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("MOBILE_JWT_SECRET is not configured");
}

const secret = new TextEncoder().encode(JWT_SECRET);

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:8081",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type MobileJwtPayload = {
  sub?: string;
  role?: string;
};

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }

  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function parsePaymentType(v: unknown): PaymentType | null {
  const s =
    typeof v === "string"
      ? v.trim().toUpperCase()
      : "";

  if (s === "CARD") {
    return PaymentType.CARD;
  }

  if (s === "CASH") {
    return PaymentType.CASH;
  }

  return null;
}

function parseClientRequestId(v: unknown): string | null {
  if (typeof v !== "string") {
    return null;
  }

  const id = v.trim();
  return id.length >= 8 ? id : null;
}

function computeReceipt(
  baseCents: number,
  cashDiscountBps: number
) {
  const base = Number.isFinite(baseCents)
    ? Math.max(0, Math.round(baseCents))
    : 0;

  const bps = Number.isFinite(cashDiscountBps)
    ? Math.max(0, Math.min(5000, Math.round(cashDiscountBps)))
    : 0;

  const discountCents =
    bps > 0
      ? Math.round(base * (bps / 10000))
      : 0;

  const finalAmountCents =
    Math.max(0, base - discountCents);

  return {
    baseAmountCents: base,
    discountCents,
    finalAmountCents,
  };
}

async function getMobileIdentity(req: NextRequest): Promise<{
  userId: string;
  role: string | null;
} | null> {
  const authHeader = req.headers.get("authorization") || "";

  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();

  if (!token) {
    return null;
  }

  try {
    const verified = await jwtVerify(token, secret);
    const payload = verified.payload as MobileJwtPayload;

    const userId =
      typeof payload.sub === "string" && payload.sub
        ? payload.sub
        : null;

    if (!userId) {
      return null;
    }

    return {
      userId,
      role:
        typeof payload.role === "string"
          ? payload.role
          : null,
    };
  } catch {
    return null;
  }
}

async function findCardOnFile(
  userId: string
): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  const needCardMsg =
    "A card is required. Please add a payment method in Billing.";

  const dbDefault = await prisma.paymentMethod.findFirst({
    where: {
      userId,
      isDefault: true,
    },
    select: {
      stripePaymentMethodId: true,
    },
  });

  if (dbDefault?.stripePaymentMethodId) {
    return { ok: true };
  }

  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      stripeCustomerId: true,
    },
  });

  const customerId =
    user?.stripeCustomerId ?? null;

  if (!customerId) {
    return {
      ok: false,
      error: needCardMsg,
    };
  }

  const customerAny =
    await stripe.customers.retrieve(customerId);

  if (
    !customerAny ||
    (customerAny as any).deleted
  ) {
    return {
      ok: false,
      error: needCardMsg,
    };
  }

  const customer =
    customerAny as Stripe.Customer;

  const defaultPm =
    customer.invoice_settings?.default_payment_method;

  const defaultPmId =
    typeof defaultPm === "string"
      ? defaultPm
      : typeof (defaultPm as any)?.id === "string"
        ? (defaultPm as any).id
        : null;

  let pmId: string | null =
    defaultPmId;

  if (!pmId) {
    const list =
      await stripe.paymentMethods.list({
        customer: customerId,
        type: "card",
        limit: 1,
      });

    pmId =
      list.data?.[0]?.id ?? null;
  }

  if (!pmId) {
    return {
      ok: false,
      error: needCardMsg,
    };
  }

  await stripe.customers.update(customerId, {
    invoice_settings: {
      default_payment_method: pmId,
    },
  });

  const pm =
    await stripe.paymentMethods.retrieve(pmId);

  if (
    !pm ||
    pm.type !== "card" ||
    !pm.card
  ) {
    return {
      ok: false,
      error: needCardMsg,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.paymentMethod.updateMany({
      where: {
        userId,
        isDefault: true,
      },
      data: {
        isDefault: false,
      },
    });

    await tx.paymentMethod.upsert({
      where: {
        userId_stripePaymentMethodId: {
          userId,
          stripePaymentMethodId: pmId,
        },
      },
      create: {
        userId,
        provider: "STRIPE",
        stripePaymentMethodId: pmId,
        brand: pm.card?.brand ?? null,
        last4: pm.card?.last4 ?? null,
        expMonth: pm.card?.exp_month ?? null,
        expYear: pm.card?.exp_year ?? null,
        isDefault: true,
      },
      update: {
        provider: "STRIPE",
        brand: pm.card?.brand ?? null,
        last4: pm.card?.last4 ?? null,
        expMonth: pm.card?.exp_month ?? null,
        expYear: pm.card?.exp_year ?? null,
        isDefault: true,
      },
    });

    await tx.user.update({
      where: {
        id: userId,
      },
      data: {
        stripeDefaultPaymentId: pmId,
      },
    });
  });

  return { ok: true };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(req: NextRequest) {
  try {
    const identity =
      await getMobileIdentity(req);

    if (!identity) {
      return NextResponse.json(
        {
          ok: false,
          error: "Not authenticated",
        },
        {
          status: 401,
          headers: corsHeaders,
        }
      );
    }

    if (identity.role !== "RIDER") {
      return NextResponse.json(
        {
          ok: false,
          error: "Not a rider",
        },
        {
          status: 403,
          headers: corsHeaders,
        }
      );
    }

    const riderId =
      identity.userId;

    const gate =
      await requireTrialOrActive({
        userId: riderId,
        role: UserRole.RIDER,
      });

    if (!gate.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: membershipErrorMessage(gate),
        },
        {
          status: 402,
          headers: corsHeaders,
        }
      );
    }

    // Match current web UX: require a card on file before any ride request.
    const cardGate =
      await findCardOnFile(riderId);

    if (!cardGate.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: cardGate.error,
        },
        {
          status: 402,
          headers: corsHeaders,
        }
      );
    }

    const body =
      await req.json();

    const clientRequestId =
      parseClientRequestId(
        body.clientRequestId
      );

    if (!clientRequestId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing/invalid clientRequestId.",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const originCity =
      body.originCity
        ? String(body.originCity)
        : "";

    const destinationCity =
      body.destinationCity
        ? String(body.destinationCity)
        : "";

    const departureTimeRaw =
      body.departureTime
        ? String(body.departureTime)
        : "";

    const originLat =
      toNumber(body.originLat);

    const originLng =
      toNumber(body.originLng);

    const destinationLat =
      toNumber(body.destinationLat);

    const destinationLng =
      toNumber(body.destinationLng);

    const passengerCount =
      typeof body.passengerCount === "number" &&
      Number.isFinite(body.passengerCount)
        ? body.passengerCount
        : 1;

    const distanceMiles =
      toNumber(body.distanceMiles);

    const paymentType =
      parsePaymentType(body.paymentType);

    if (!paymentType) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing/invalid paymentType (CARD or CASH).",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (
      !originCity ||
      !destinationCity ||
      !departureTimeRaw ||
      distanceMiles == null
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing fields",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (
      !Number.isFinite(passengerCount) ||
      passengerCount < 1 ||
      passengerCount > 6
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Passenger count must be between 1 and 6.",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (
      distanceMiles <= 0
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Distance must be greater than zero.",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const departureTime =
      new Date(departureTimeRaw);

    if (
      Number.isNaN(
        departureTime.getTime()
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid departureTime",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (
      originLat == null ||
      originLng == null ||
      destinationLat == null ||
      destinationLng == null
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing coordinates (originLat/originLng/destinationLat/destinationLng).",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const totalPriceCents =
      Math.round(
        (3 + 2 * distanceMiles) * 100
      );

    const cashDiscountBps =
      paymentType === PaymentType.CASH
        ? 1000
        : 0;

    const receipt =
      paymentType === PaymentType.CASH
        ? computeReceipt(
            totalPriceCents,
            cashDiscountBps
          )
        : {
            baseAmountCents: totalPriceCents,
            discountCents: 0,
            finalAmountCents: totalPriceCents,
          };

    const { ride, booking } =
      await prisma.$transaction(
        async (tx) => {
          const ride =
            await tx.ride.upsert({
              where: {
                clientRequestId,
              },
              update: {
                riderId,
                originCity,
                originLat,
                originLng,
                destinationCity,
                destinationLat,
                destinationLng,
                departureTime,
                passengerCount,
                distanceMiles,
                totalPriceCents,
                status: RideStatus.OPEN,
              },
              create: {
                clientRequestId,
                riderId,
                originCity,
                originLat,
                originLng,
                destinationCity,
                destinationLat,
                destinationLng,
                departureTime,
                passengerCount,
                distanceMiles,
                totalPriceCents,
                status: RideStatus.OPEN,
              },
            });

          const existingBooking =
            await tx.booking.findFirst({
              where: {
                rideId: ride.id,
                riderId,
              },
              orderBy: {
                createdAt: "asc",
              },
              select: {
                id: true,
              },
            });

          if (!existingBooking) {
            const booking =
              await tx.booking.create({
                data: {
                  rideId: ride.id,
                  riderId,
                  status:
                    BookingStatus.PENDING,

                  paymentType,
                  cashDiscountBps,

                  originalPaymentType:
                    paymentType,

                  originalCashDiscountBps:
                    cashDiscountBps,

                  paymentMethodId: null,
                  currency: "usd",

                  baseAmountCents:
                    receipt.baseAmountCents,

                  discountCents:
                    receipt.discountCents,

                  finalAmountCents:
                    receipt.finalAmountCents,
                } as any,
              });

            return {
              ride,
              booking,
            };
          }

          const updated =
            await tx.booking.update({
              where: {
                id: existingBooking.id,
              },
              data: {
                paymentType,
                cashDiscountBps,
                currency: "usd",

                baseAmountCents:
                  receipt.baseAmountCents,

                discountCents:
                  receipt.discountCents,

                finalAmountCents:
                  receipt.finalAmountCents,
              } as any,
            });

          return {
            ride,
            booking: updated,
          };
        }
      );

    return NextResponse.json(
      {
        ok: true,
        ride,
        booking,
      },
      {
        status: 201,
        headers: corsHeaders,
      }
    );
  } catch (err) {
    console.error(
      "[mobile/rider/request-ride] unhandled error:",
      err
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          process.env.NODE_ENV === "development" &&
          err instanceof Error &&
          err.message
            ? err.message
            : "Internal server error",
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}