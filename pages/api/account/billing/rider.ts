// pages/api/account/billing/rider.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import { prisma } from "../../../../lib/prisma";
import { BookingStatus, PaymentType, RideStatus } from "@prisma/client";

type RiderBillingRow = {
  id: string;
  createdAt: string;
  status: string;
  currency: string;
  amountCents: number;

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
  | { ok: true; payments: RiderBillingRow[] }
  | { ok: false; error: string };

function toIso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

function normalizeCurrency(v: string | null | undefined) {
  return (v || "USD").toUpperCase();
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

    const take = Math.min(Number(req.query.take ?? 50) || 50, 200);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;

    // Primary source: RidePayment rows
    const payments = await prisma.ridePayment.findMany({
      where: { riderId: userId },
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
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

    const mappedPayments: RiderBillingRow[] = payments.map((p) => ({
      id: p.id,
      createdAt: p.createdAt.toISOString(),
      status: String(p.status),
      currency: normalizeCurrency(p.currency),
      amountCents:
        typeof p.finalAmountCents === "number" && p.finalAmountCents > 0
          ? p.finalAmountCents
          : p.amountCents,
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
    }));

    // Fallback source:
    // completed bookings for rides that have no RidePayment row yet.
    // This makes billing history usable even for older rides created before RidePayment rows were written consistently.
    const rideIdsWithPayments = new Set(
      mappedPayments.map((p) => p.ride?.id).filter((v): v is string => Boolean(v))
    );

    const completedBookings = await prisma.booking.findMany({
      where: {
        riderId: userId,
        status: BookingStatus.COMPLETED,
        ride: {
          status: RideStatus.COMPLETED,
        },
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
      .map((b) => ({
        id: `booking_${b.id}`,
        createdAt: b.updatedAt.toISOString(),
        status:
          b.paymentType === PaymentType.CASH
            ? "SUCCEEDED"
            : "COMPLETED",
        currency: normalizeCurrency(b.currency),
        amountCents:
          typeof b.finalAmountCents === "number" && b.finalAmountCents > 0
            ? b.finalAmountCents
            : typeof b.baseAmountCents === "number" && b.baseAmountCents > 0
            ? b.baseAmountCents
            : 0,
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
      }))
      .filter((row) => row.amountCents > 0);

    const all = [...mappedPayments, ...fallbackRows].sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return res.status(200).json({ ok: true, payments: all.slice(0, take) });
  } catch (err: any) {
    console.error("Rider billing API error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Internal error",
    });
  }
}