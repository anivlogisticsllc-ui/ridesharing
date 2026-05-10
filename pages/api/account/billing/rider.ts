// pages/api/account/billing/rider.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import { prisma } from "../../../../lib/prisma";
import {
  BookingStatus,
  DisputeStatus,
  PaymentType,
  RidePaymentStatus,
  RideStatus,
} from "@prisma/client";

type RiderPaymentType = "CARD" | "CASH" | "UNKNOWN";

type RiderBillingRow = {
  id: string;
  createdAt: string;
  status: string;
  currency: string;

  amountCents: number;
  baseFareCents: number;
  tipCents: number;
  discountCents: number;
  convenienceFeeCents: number;
  totalChargedCents: number;

  paymentType: RiderPaymentType;
  tipStatus?: string | null;
  tipPercent?: number | null;

  refundIssued?: boolean;
  refundAmountCents?: number;
  refundIssuedAt?: string | null;
  originalAmountCents?: number;

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

function asCents(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.max(0, Math.round(v))
    : 0;
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
    const userId = (session?.user as { id?: string } | undefined)?.id;
    const role = (session?.user as { role?: "RIDER" | "DRIVER" | "ADMIN" } | undefined)?.role;

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

    const completedBookings = await prisma.booking.findMany({
      where: {
        riderId: userId,
        status: { in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED] },
        ride: { status: RideStatus.COMPLETED },
      },
      orderBy: { updatedAt: "desc" },
      take: 1000,
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

    const bookingByRideId = new Map<
      string,
      {
        id: string;
        rideId: string;
        paymentType: PaymentType | null;
        originalPaymentType: PaymentType | null;
        finalAmountCents: number | null;
        baseAmountCents: number | null;
        discountCents: number | null;
        currency: string | null;
        updatedAt: Date;
        ride: {
          id: string;
          departureTime: Date | null;
          originCity: string | null;
          destinationCity: string | null;
          status: RideStatus | null;
        } | null;
      }
    >();

    for (const b of completedBookings) {
      if (b.rideId && !bookingByRideId.has(b.rideId)) {
        bookingByRideId.set(b.rideId, {
          id: b.id,
          rideId: b.rideId,
          paymentType: b.paymentType,
          originalPaymentType: b.originalPaymentType,
          finalAmountCents: b.finalAmountCents,
          baseAmountCents: b.baseAmountCents,
          discountCents: b.discountCents,
          currency: b.currency,
          updatedAt: b.updatedAt,
          ride: b.ride
            ? {
                id: b.ride.id,
                departureTime: b.ride.departureTime,
                originCity: b.ride.originCity,
                destinationCity: b.ride.destinationCity,
                status: b.ride.status,
              }
            : null,
        });
      }
    }

    const bookingIds = completedBookings.map((b) => b.id);
    const rideIds = completedBookings
      .map((b) => b.rideId)
      .filter((v): v is string => Boolean(v));

    const disputes =
      bookingIds.length || rideIds.length
        ? await prisma.dispute.findMany({
            where: {
              status: DisputeStatus.RESOLVED_RIDER,
              refundIssued: true,
              OR: [
                ...(bookingIds.length ? [{ bookingId: { in: bookingIds } }] : []),
                ...(rideIds.length ? [{ rideId: { in: rideIds } }] : []),
              ],
            },
            orderBy: [{ refundIssuedAt: "desc" }, { createdAt: "desc" }],
            select: {
              id: true,
              bookingId: true,
              rideId: true,
              refundAmountCents: true,
              refundIssuedAt: true,
              createdAt: true,
            },
          })
        : [];

    const refundByRideId = new Map<
      string,
      {
        disputeId: string;
        refundAmountCents: number;
        refundIssuedAt: Date | null;
      }
    >();

    for (const d of disputes) {
      if (!d.rideId) continue;
      if (!refundByRideId.has(d.rideId)) {
        refundByRideId.set(d.rideId, {
          disputeId: d.id,
          refundAmountCents: asCents(d.refundAmountCents),
          refundIssuedAt: d.refundIssuedAt ?? null,
        });
      }
    }

    const mappedPayments: RiderBillingRow[] = ridePayments.map((p) => {
      const booking = p.rideId ? bookingByRideId.get(p.rideId) : undefined;
      const refund = p.rideId ? refundByRideId.get(p.rideId) : undefined;

      const paymentType = derivePaymentType({
        paymentType: p.paymentType ?? booking?.paymentType ?? booking?.originalPaymentType,
        hasPaymentMethod: Boolean(p.paymentMethod),
        stripePaymentIntentId: p.stripePaymentIntentId,
      });

      const currency = normalizeCurrency(p.currency || booking?.currency);

      const baseFareCents =
        asCents(p.baseAmountCents) ||
        asCents(booking?.baseAmountCents) ||
        asCents(p.amountCents);

      const tipCents = asCents(p.tipAmountCents);

      const discountCents =
        asCents(p.discountCents) ||
        asCents(booking?.discountCents);

      const totalChargedCents =
        asCents(p.finalAmountCents) ||
        asCents(booking?.finalAmountCents) ||
        Math.max(0, baseFareCents - discountCents + tipCents);

      const convenienceFeeCents = Math.max(
        0,
        totalChargedCents - Math.max(0, baseFareCents - discountCents) - tipCents
      );

      const status =
        refund && refund.refundAmountCents > 0
          ? "REFUNDED"
          : String(p.status || "UNKNOWN").toUpperCase();

      return {
        id: p.id,
        createdAt: toIso(p.createdAt)!,
        status,
        currency,

        amountCents: totalChargedCents,
        baseFareCents,
        tipCents,
        discountCents,
        convenienceFeeCents,
        totalChargedCents,

        paymentType,
        tipStatus: p.tipStatus ?? null,
        tipPercent: p.tipPercent ?? null,

        refundIssued: Boolean(refund && refund.refundAmountCents > 0),
        refundAmountCents: refund?.refundAmountCents ?? 0,
        refundIssuedAt: toIso(refund?.refundIssuedAt),
        originalAmountCents:
          refund && refund.refundAmountCents > 0 ? totalChargedCents : undefined,

        ride: p.ride
          ? {
              id: p.ride.id,
              departureTime: toIso(p.ride.departureTime),
              originCity: p.ride.originCity,
              destinationCity: p.ride.destinationCity,
              status: p.ride.status ?? null,
            }
          : booking?.ride
          ? {
              id: booking.ride.id,
              departureTime: toIso(booking.ride.departureTime),
              originCity: booking.ride.originCity,
              destinationCity: booking.ride.destinationCity,
              status: booking.ride.status ?? null,
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

    const summary = {
      count: mappedPayments.length,
      totalAmountCents: mappedPayments.reduce(
        (sum, row) => sum + asCents(row.totalChargedCents),
        0
      ),
    };

    return res.status(200).json({
      ok: true,
      payments: mappedPayments,
      summary,
    });
  } catch (err) {
    console.error("Rider billing API error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to load rider billing",
    });
  }
}