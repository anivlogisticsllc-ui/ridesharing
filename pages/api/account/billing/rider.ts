// pages/api/account/billing/rider.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import { prisma } from "../../../../lib/prisma";
import { BookingStatus, PaymentType, RideStatus } from "@prisma/client";

type RiderPaymentType = "CARD" | "CASH" | "UNKNOWN";

type RiderBillingRow = {
  id: string;
  createdAt: string;
  status: string;
  currency: string;
  amountCents: number;
  paymentType: RiderPaymentType;
  ride: {
    id: string;
    departureTime: string | null;
    originCity: string | null;
    destinationCity: string | null;
    status: string | null;
  } | null;
  paymentMethod: {
    id: string;
    brand: string | null;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
    provider: string;
  } | null;
};

type RiderBillingResponse =
  | {
      ok: true;
      payments: RiderBillingRow[];
      summary: {
        count: number;
        totalAmountCents: number;
      };
    }
  | { ok: false; error: string };

function toIso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

function normalizeCurrency(v: string | null | undefined) {
  return (v || "USD").toUpperCase();
}

function derivePaymentType(args: {
  paymentType: unknown;
  hasPaymentMethod: boolean;
  stripePaymentIntentId?: string | null;
}): RiderPaymentType {
  if (args.paymentType === PaymentType.CASH || args.paymentType === "CASH") return "CASH";
  if (args.paymentType === PaymentType.CARD || args.paymentType === "CARD") return "CARD";
  if (args.hasPaymentMethod) return "CARD";
  if (args.stripePaymentIntentId) return "CARD";
  return "UNKNOWN";
}

function isFallbackCardCharge(args: {
  paymentType: PaymentType | null | undefined;
  cashNotPaidAt?: Date | null;
  fallbackCardChargedAt?: Date | null;
}) {
  return (
    args.paymentType === PaymentType.CARD &&
    Boolean(args.cashNotPaidAt) &&
    Boolean(args.fallbackCardChargedAt)
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RiderBillingResponse>
) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const session = await getServerSession(req, res, authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    const role = (session?.user as any)?.role as "RIDER" | "DRIVER" | undefined;

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (role !== "RIDER") {
      return res.status(403).json({ ok: false, error: "Rider access only" });
    }

    const take = Math.min(Number(req.query.take ?? 500) || 500, 1000);

    const ridePayments = await prisma.ridePayment.findMany({
      where: { riderId: userId },
      orderBy: { createdAt: "desc" },
      take,
      include: {
        ride: {
          select: {
            id: true,
            departureTime: true,
            originCity: true,
            destinationCity: true,
            status: true,
          },
        },
        paymentMethod: {
          select: {
            id: true,
            provider: true,
            brand: true,
            last4: true,
            expMonth: true,
            expYear: true,
          },
        },
      },
    });

    const rideIdsFromPayments = Array.from(
      new Set(ridePayments.map((p) => p.rideId).filter((v): v is string => Boolean(v)))
    );

    const bookingsForPaidRides = rideIdsFromPayments.length
      ? await prisma.booking.findMany({
          where: {
            riderId: userId,
            rideId: { in: rideIdsFromPayments },
          },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            rideId: true,
            paymentType: true,
            finalAmountCents: true,
            baseAmountCents: true,
            currency: true,
            cashNotPaidAt: true,
            fallbackCardChargedAt: true,
          },
        })
      : [];

    const bookingByRideId = new Map<
      string,
      {
        id: string;
        rideId: string;
        paymentType: PaymentType | null;
        finalAmountCents: number | null;
        baseAmountCents: number | null;
        currency: string | null;
        cashNotPaidAt: Date | null;
        fallbackCardChargedAt: Date | null;
      }
    >();

    for (const b of bookingsForPaidRides) {
      if (!bookingByRideId.has(b.rideId)) {
        bookingByRideId.set(b.rideId, b);
      }
    }

    const mappedPayments: RiderBillingRow[] = ridePayments.map((p) => {
      const booking = bookingByRideId.get(p.rideId);

      const overriddenPaymentType =
        booking?.paymentType ??
        (p.paymentType as PaymentType | null | undefined) ??
        null;

      const amountCents =
        typeof booking?.finalAmountCents === "number" && booking.finalAmountCents > 0
          ? booking.finalAmountCents
          : typeof p.finalAmountCents === "number" && p.finalAmountCents > 0
          ? p.finalAmountCents
          : p.amountCents;

      const currency = normalizeCurrency(booking?.currency ?? p.currency);

      return {
        id: p.id,
        createdAt: p.createdAt.toISOString(),
        status: String(p.status || "").toUpperCase(),
        currency,
        amountCents,
        paymentType: derivePaymentType({
          paymentType: overriddenPaymentType,
          hasPaymentMethod: Boolean(p.paymentMethod),
          stripePaymentIntentId: p.stripePaymentIntentId,
        }),
        ride: p.ride
          ? {
              id: p.ride.id,
              departureTime: toIso(p.ride.departureTime as any),
              originCity: (p.ride as any).originCity ?? null,
              destinationCity: (p.ride as any).destinationCity ?? null,
              status: (p.ride as any).status ?? null,
            }
          : null,
        paymentMethod: p.paymentMethod
          ? {
              id: p.paymentMethod.id,
              provider: p.paymentMethod.provider,
              brand: p.paymentMethod.brand,
              last4: p.paymentMethod.last4,
              expMonth: p.paymentMethod.expMonth,
              expYear: p.paymentMethod.expYear,
            }
          : null,
      };
    });

    const rideIdsWithPayments = new Set(
      mappedPayments.map((p) => p.ride?.id).filter((v): v is string => Boolean(v))
    );

    const completedBookings = await prisma.booking.findMany({
      where: {
        riderId: userId,
        status: BookingStatus.COMPLETED,
        ride: { status: RideStatus.COMPLETED },
      },
      orderBy: { updatedAt: "desc" },
      take,
      include: {
        ride: {
          select: {
            id: true,
            departureTime: true,
            originCity: true,
            destinationCity: true,
            status: true,
          },
        },
      },
    });

    const fallbackRows: RiderBillingRow[] = completedBookings
      .filter((b) => b.ride && !rideIdsWithPayments.has(b.ride.id))
      .map((b): RiderBillingRow => {
        const paymentType: RiderPaymentType = derivePaymentType({
          paymentType: b.paymentType,
          hasPaymentMethod: false,
          stripePaymentIntentId: null,
        });

        const amountCents =
          typeof b.finalAmountCents === "number" && b.finalAmountCents > 0
            ? b.finalAmountCents
            : typeof b.baseAmountCents === "number" && b.baseAmountCents > 0
            ? b.baseAmountCents
            : 0;

        return {
          id: `booking_${b.id}`,
          createdAt: b.updatedAt.toISOString(),
          status: "COMPLETED",
          currency: normalizeCurrency(b.currency),
          amountCents,
          paymentType,
          ride: b.ride
            ? {
                id: b.ride.id,
                departureTime: toIso(b.ride.departureTime as any),
                originCity: (b.ride as any).originCity ?? null,
                destinationCity: (b.ride as any).destinationCity ?? null,
                status: (b.ride as any).status ?? null,
              }
            : null,
          paymentMethod: null,
        };
      })
      .filter((row) => row.amountCents > 0);

    const all = [...mappedPayments, ...fallbackRows].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const totalAmountCents = all.reduce((sum, p) => sum + (p.amountCents || 0), 0);

    return res.status(200).json({
      ok: true,
      payments: all,
      summary: {
        count: all.length,
        totalAmountCents,
      },
    });
  } catch (err: any) {
    console.error("Rider billing API error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Internal error",
    });
  }
}