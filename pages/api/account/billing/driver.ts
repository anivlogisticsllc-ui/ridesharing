// pages/api/account/billing/driver.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import { prisma } from "../../../../lib/prisma";
import { PaymentType } from "@prisma/client";

type DriverBillingResponse =
  | {
      ok: true;
      payouts: {
        id: string;
        amountCents: number;
        currency: string;
        status: string;
        createdAt: string;
      }[];
      serviceFees: {
        totalFeesCents: number;
        currency: string;
        rideCount: number;
      };
      earningsSummary: {
        grossAmountCents: number;
        serviceFeeCents: number;
        netAmountCents: number;
        pendingNetAmountCents: number;
        paidNetAmountCents: number;
        rideCount: number;
      };
      transactions: {
        id: string;
        rideId: string;
        createdAt: string;
        status: string;
        grossAmountCents: number;
        serviceFeeCents: number;
        netAmountCents: number;
        paymentType: "CARD" | "CASH" | "UNKNOWN";
        payoutEligible: boolean;
        ride: {
          id: string;
          departureTime: string | null;
          originCity: string | null;
          destinationCity: string | null;
          status: string | null;
        } | null;
      }[];
      membershipCharges: {
        id: string;
        amountCents: number;
        currency: string;
        status: string;
        createdAt: string;
        paidAt: string | null;
        failedAt: string | null;
      }[];
    }
  | { ok: false; error: string };

const PLATFORM_FEE_BPS = 1000; // 10%

function toIso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

function computeDriverSplit(collectedAmountCents: number) {
  const grossAmountCents = Math.max(0, Math.round(collectedAmountCents));
  const serviceFeeCents = Math.round(grossAmountCents * (PLATFORM_FEE_BPS / 10000));
  const netAmountCents = Math.max(0, grossAmountCents - serviceFeeCents);

  return { grossAmountCents, serviceFeeCents, netAmountCents };
}

function deriveDriverPaymentType(args: {
  paymentType: PaymentType | null | undefined;
}): "CARD" | "CASH" | "UNKNOWN" {
  if (args.paymentType === PaymentType.CARD) return "CARD";
  if (args.paymentType === PaymentType.CASH) return "CASH";
  return "UNKNOWN";
}

function isFallbackCardRide(args: {
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

function isPayoutEligible(args: {
  paymentType: PaymentType | null | undefined;
  cashNotPaidAt?: Date | null;
  fallbackCardChargedAt?: Date | null;
}) {
  if (args.paymentType === PaymentType.CARD) return true;
  if (
    args.paymentType === PaymentType.CASH &&
    args.cashNotPaidAt &&
    args.fallbackCardChargedAt
  ) {
    return true;
  }
  return false;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DriverBillingResponse>
) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const session = await getServerSession(req, res, authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    const role = (session?.user as any)?.role as "DRIVER" | "ADMIN" | "RIDER" | undefined;

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (role !== "DRIVER" && role !== "ADMIN") {
      return res.status(403).json({ ok: false, error: "Driver access only" });
    }

    const payouts = await prisma.payout.findMany({
      where: { driverId: userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        amountCents: true,
        currency: true,
        status: true,
        createdAt: true,
      },
    });

    const transactions = await prisma.transaction.findMany({
      where: { driverId: userId },
      orderBy: { createdAt: "desc" },
      take: 200,
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

    const rideIds = Array.from(
      new Set(transactions.map((t) => t.rideId).filter((v): v is string => Boolean(v)))
    );

    const relatedBookings = rideIds.length
      ? await prisma.booking.findMany({
          where: {
            rideId: { in: rideIds },
          },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            rideId: true,
            paymentType: true,
            originalPaymentType: true,
            cashNotPaidAt: true,
            fallbackCardChargedAt: true,
            baseAmountCents: true,
            finalAmountCents: true,
          },
        })
      : [];

    const bookingByRideId = new Map<
      string,
      {
        id: string;
        rideId: string;
        paymentType: PaymentType | null;
        originalPaymentType: PaymentType | null;
        cashNotPaidAt: Date | null;
        fallbackCardChargedAt: Date | null;
        baseAmountCents: number | null;
        finalAmountCents: number | null;
      }
    >();

    for (const b of relatedBookings) {
      if (!bookingByRideId.has(b.rideId)) {
        bookingByRideId.set(b.rideId, b);
      }
    }

    const enrichedTransactions = transactions.map((t) => {
      const booking = bookingByRideId.get(t.rideId);

      const paymentType = deriveDriverPaymentType({
        paymentType: booking?.paymentType,
      });

      const payoutEligible = isPayoutEligible({
        paymentType: booking?.paymentType,
        cashNotPaidAt: booking?.cashNotPaidAt,
        fallbackCardChargedAt: booking?.fallbackCardChargedAt,
      });

      const fallbackCardRide = isFallbackCardRide({
        paymentType: booking?.paymentType,
        cashNotPaidAt: booking?.cashNotPaidAt,
        fallbackCardChargedAt: booking?.fallbackCardChargedAt,
      });

      const overrideSplit =
        fallbackCardRide &&
        typeof booking?.finalAmountCents === "number" &&
        booking.finalAmountCents > 0
          ? computeDriverSplit(booking.finalAmountCents)
          : null;

      return {
        id: t.id,
        rideId: t.rideId,
        createdAt: t.createdAt.toISOString(),
        status: String(t.status),
        grossAmountCents: overrideSplit?.grossAmountCents ?? t.grossAmountCents,
        serviceFeeCents: overrideSplit?.serviceFeeCents ?? t.serviceFeeCents,
        netAmountCents: overrideSplit?.netAmountCents ?? t.netAmountCents,
        paymentType,
        payoutEligible,
        ride: t.ride
          ? {
              id: t.ride.id,
              departureTime: toIso(t.ride.departureTime as any),
              originCity: (t.ride as any).originCity ?? null,
              destinationCity: (t.ride as any).destinationCity ?? null,
              status: (t.ride as any).status ?? null,
            }
          : null,
      };
    });

    const grossAmountCents = enrichedTransactions.reduce((sum, t) => sum + (t.grossAmountCents || 0), 0);
    const serviceFeeCents = enrichedTransactions.reduce((sum, t) => sum + (t.serviceFeeCents || 0), 0);
    const netAmountCents = enrichedTransactions.reduce((sum, t) => sum + (t.netAmountCents || 0), 0);

    const paidPayoutAmountCents = payouts
      .filter((p) => String(p.status).toUpperCase() === "PAID")
      .reduce((sum, p) => sum + p.amountCents, 0);

    const payoutEligibleNetAmountCents = enrichedTransactions
      .filter((t) => t.payoutEligible)
      .reduce((sum, t) => sum + t.netAmountCents, 0);

    const pendingNetAmountCents = Math.max(0, payoutEligibleNetAmountCents - paidPayoutAmountCents);

    const membershipCharges = await prisma.membershipCharge.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        amountCents: true,
        currency: true,
        status: true,
        createdAt: true,
        paidAt: true,
        failedAt: true,
      },
    });

    return res.status(200).json({
      ok: true,
      payouts: payouts.map((p) => ({
        id: p.id,
        amountCents: p.amountCents,
        currency: p.currency,
        status: String(p.status),
        createdAt: p.createdAt.toISOString(),
      })),
      serviceFees: {
        totalFeesCents: serviceFeeCents,
        currency: "USD",
        rideCount: enrichedTransactions.length,
      },
      earningsSummary: {
        grossAmountCents,
        serviceFeeCents,
        netAmountCents,
        pendingNetAmountCents,
        paidNetAmountCents: paidPayoutAmountCents,
        rideCount: enrichedTransactions.length,
      },
      transactions: enrichedTransactions,
      membershipCharges: membershipCharges.map((c) => ({
        id: c.id,
        amountCents: c.amountCents,
        currency: c.currency,
        status: String(c.status),
        createdAt: c.createdAt.toISOString(),
        paidAt: toIso(c.paidAt),
        failedAt: toIso(c.failedAt),
      })),
    });
  } catch (err: any) {
    console.error("Driver billing API error:", err);
    return res.status(500).json({ ok: false, error: "Failed to load driver billing" });
  }
}