// pages/api/account/billing/rider.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import { prisma } from "../../../../lib/prisma";
import {
  BookingStatus,
  DisputeStatus,
  PaymentType,
  RideStatus,
} from "@prisma/client";

type RiderPaymentType = "CARD" | "CASH" | "UNKNOWN";

type RiderBillingRow = {
  id: string;
  createdAt: string;
  status: string;
  currency: string;
  amountCents: number;
  paymentType: RiderPaymentType;
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
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
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
            orderBy: [
              { refundIssuedAt: "desc" },
              { createdAt: "desc" },
            ],
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

      const overriddenPaymentType =
        booking?.paymentType ??
        (p.paymentType as PaymentType | null | undefined) ??
        null;

      const originalAmountCents =
        asCents(booking?.finalAmountCents) ||
        asCents(p.finalAmountCents) ||
        asCents(p.amountCents);

      const currency = normalizeCurrency(booking?.currency ?? p.currency);

      return {
        id: p.id,
        createdAt: p.createdAt.toISOString(),
        status: String(p.status || "").toUpperCase(),
        currency,
        amountCents: originalAmountCents,
        paymentType: derivePaymentType({
          paymentType: overriddenPaymentType,
          hasPaymentMethod: Boolean(p.paymentMethod),
          stripePaymentIntentId: p.stripePaymentIntentId,
        }),
        refundIssued: Boolean(refund && refund.refundAmountCents > 0),
        refundAmountCents: refund?.refundAmountCents ?? 0,
        refundIssuedAt: toIso(refund?.refundIssuedAt),
        originalAmountCents,
        ride: p.ride
          ? {
              id: p.ride.id,
              departureTime: toIso(p.ride.departureTime as Date | null | undefined),
              originCity: p.ride.originCity ?? null,
              destinationCity: p.ride.destinationCity ?? null,
              status: p.ride.status ?? null,
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

    const fallbackRows: RiderBillingRow[] = completedBookings
      .filter((b) => b.ride && !rideIdsWithPayments.has(b.ride.id))
      .map((b) => {
        const refund = b.rideId ? refundByRideId.get(b.rideId) : undefined;
        const originalAmountCents =
          asCents(b.finalAmountCents) ||
          asCents(b.baseAmountCents);

        return {
          id: `booking_${b.id}`,
          createdAt: b.updatedAt.toISOString(),
          status: "COMPLETED",
          currency: normalizeCurrency(b.currency),
          amountCents: originalAmountCents,
          paymentType: derivePaymentType({
            paymentType: b.paymentType,
            hasPaymentMethod: false,
            stripePaymentIntentId: null,
          }),
          refundIssued: Boolean(refund && refund.refundAmountCents > 0),
          refundAmountCents: refund?.refundAmountCents ?? 0,
          refundIssuedAt: toIso(refund?.refundIssuedAt),
          originalAmountCents,
          ride: b.ride
            ? {
                id: b.ride.id,
                departureTime: toIso(b.ride.departureTime as Date | null | undefined),
                originCity: b.ride.originCity ?? null,
                destinationCity: b.ride.destinationCity ?? null,
                status: b.ride.status ?? null,
              }
            : null,
          paymentMethod: null,
        };
      })
      .filter((row) => row.amountCents > 0);

    const refundRows: RiderBillingRow[] = disputes
      .filter((d) => asCents(d.refundAmountCents) > 0)
      .map((d) => {
        const booking = d.rideId ? bookingByRideId.get(d.rideId) : undefined;

        return {
          id: `refund_${d.id}`,
          createdAt: (d.refundIssuedAt ?? d.createdAt).toISOString(),
          status: "REFUNDED",
          currency: normalizeCurrency(booking?.currency),
          amountCents: -asCents(d.refundAmountCents),
          paymentType: "CARD",
          refundIssued: true,
          refundAmountCents: asCents(d.refundAmountCents),
          refundIssuedAt: toIso(d.refundIssuedAt),
          originalAmountCents: booking?.finalAmountCents
            ? asCents(booking.finalAmountCents)
            : undefined,
          ride: booking?.ride
            ? {
                id: booking.ride.id,
                departureTime: toIso(booking.ride.departureTime),
                originCity: booking.ride.originCity ?? null,
                destinationCity: booking.ride.destinationCity ?? null,
                status: booking.ride.status ?? null,
              }
            : null,
          paymentMethod: null,
        };
      });

    const seenIds = new Set<string>();
    const all = [...mappedPayments, ...fallbackRows, ...refundRows]
      .filter((row) => {
        if (seenIds.has(row.id)) return false;
        seenIds.add(row.id);
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const totalAmountCents = all.reduce((sum, p) => sum + (p.amountCents || 0), 0);

    return res.status(200).json({
      ok: true,
      payments: all,
      summary: {
        count: all.length,
        totalAmountCents,
      },
    });
  } catch (err: unknown) {
    console.error("Rider billing API error:", err);
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Internal error",
    });
  }
}