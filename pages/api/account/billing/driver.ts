// OATH: Clean replacement file
// FILE: pages/api/account/billing/driver.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import { prisma } from "../../../../lib/prisma";
import { DisputeStatus, PaymentType } from "@prisma/client";

type DriverBillingRow = {
  id: string;
  rideId: string;
  createdAt: string;
  status: string;
  grossAmountCents: number;
  serviceFeeCents: number;
  netAmountCents: number;
  paymentType: "CARD" | "CASH" | "UNKNOWN";
  payoutEligible: boolean;

  refundIssued?: boolean;
  refundAmountCents?: number;
  originalGrossAmountCents?: number;
  originalServiceFeeCents?: number;
  originalNetAmountCents?: number;
  refundIssuedAt?: string | null;

  ride: {
    id: string;
    departureTime: string | null;
    originCity: string | null;
    destinationCity: string | null;
    status: string | null;
  } | null;
};

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
      transactions: DriverBillingRow[];
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

const PLATFORM_FEE_BPS = 1000;

function toIso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

function asNonNegativeCents(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
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

function isCashPreservedRefund(args: {
  originalPaymentType: PaymentType | null | undefined;
  paymentType: PaymentType | null | undefined;
  cashNotPaidAt?: Date | null;
  fallbackCardChargedAt?: Date | null;
  refundAmountCents?: number;
}) {
  return (
    args.originalPaymentType === PaymentType.CASH &&
    args.paymentType === PaymentType.CARD &&
    Boolean(args.cashNotPaidAt) &&
    Boolean(args.fallbackCardChargedAt) &&
    asNonNegativeCents(args.refundAmountCents) > 0
  );
}

function isPayoutEligible(args: {
  adjustedNetAmountCents?: number;
  cashPreservedRefund?: boolean;
}) {
  if (args.cashPreservedRefund) return true;
  return asNonNegativeCents(args.adjustedNetAmountCents) > 0;
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
    const userId = (session?.user as { id?: string } | undefined)?.id;
    const role = (session?.user as {
      role?: "DRIVER" | "ADMIN" | "RIDER";
    } | undefined)?.role;

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

    const disputes = rideIds.length
      ? await prisma.dispute.findMany({
          where: {
            driverId: userId,
            rideId: { in: rideIds },
            status: DisputeStatus.RESOLVED_RIDER,
            refundIssued: true,
          },
          orderBy: { refundIssuedAt: "desc" },
          select: {
            id: true,
            rideId: true,
            refundAmountCents: true,
            refundIssuedAt: true,
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

    const disputeByRideId = new Map<
      string,
      {
        refundAmountCents: number;
        refundIssuedAt: Date | null;
      }
    >();

    for (const d of disputes) {
      if (!disputeByRideId.has(d.rideId)) {
        disputeByRideId.set(d.rideId, {
          refundAmountCents: asNonNegativeCents(d.refundAmountCents),
          refundIssuedAt: d.refundIssuedAt ?? null,
        });
      }
    }

    const allTransactions: DriverBillingRow[] = transactions.map((t) => {
      const booking = bookingByRideId.get(t.rideId);
      const dispute = disputeByRideId.get(t.rideId);

      const bookingFinalAmountCents = asNonNegativeCents(booking?.finalAmountCents);
      const txGrossAmountCents = asNonNegativeCents(t.grossAmountCents);
      const txServiceFeeCents = asNonNegativeCents(t.serviceFeeCents);
      const txNetAmountCents = asNonNegativeCents(t.netAmountCents);

      const refundAmountCents = Math.min(
        asNonNegativeCents(dispute?.refundAmountCents),
        Math.max(bookingFinalAmountCents, txGrossAmountCents)
      );

      const refundIssued = refundAmountCents > 0;

      const cashPreservedRefund = isCashPreservedRefund({
        originalPaymentType: booking?.originalPaymentType,
        paymentType: booking?.paymentType,
        cashNotPaidAt: booking?.cashNotPaidAt,
        fallbackCardChargedAt: booking?.fallbackCardChargedAt,
        refundAmountCents,
      });

      let displayGrossAmountCents = txGrossAmountCents;
      let displayServiceFeeCents = txServiceFeeCents;
      let displayNetAmountCents = txNetAmountCents;

      // Correct special-case accounting:
      // refunded fallback-card charge on an originally cash ride
      // should still preserve ride-value fee/net accounting
      if (cashPreservedRefund && bookingFinalAmountCents > 0) {
        const split = computeDriverSplit(bookingFinalAmountCents);
        displayGrossAmountCents = split.grossAmountCents;
        displayServiceFeeCents = split.serviceFeeCents;
        displayNetAmountCents = split.netAmountCents;
      } else if (refundIssued) {
        const adjustedBase = Math.max(0, txGrossAmountCents - refundAmountCents);
        const split = computeDriverSplit(adjustedBase);
        displayGrossAmountCents = split.grossAmountCents;
        displayServiceFeeCents = split.serviceFeeCents;
        displayNetAmountCents = split.netAmountCents;
      }

      return {
        id: t.id,
        rideId: t.rideId,
        createdAt: t.createdAt.toISOString(),
        status: refundIssued ? "REFUNDED" : String(t.status).toUpperCase(),

        grossAmountCents: displayGrossAmountCents,
        serviceFeeCents: displayServiceFeeCents,
        netAmountCents: displayNetAmountCents,

        originalGrossAmountCents:
          cashPreservedRefund && bookingFinalAmountCents > 0
            ? bookingFinalAmountCents
            : txGrossAmountCents,
        originalServiceFeeCents:
          cashPreservedRefund && bookingFinalAmountCents > 0
            ? computeDriverSplit(bookingFinalAmountCents).serviceFeeCents
            : txServiceFeeCents,
        originalNetAmountCents:
          cashPreservedRefund && bookingFinalAmountCents > 0
            ? computeDriverSplit(bookingFinalAmountCents).netAmountCents
            : txNetAmountCents,

        refundIssued,
        refundAmountCents,
        refundIssuedAt: toIso(dispute?.refundIssuedAt),

        paymentType: deriveDriverPaymentType({
          paymentType: booking?.paymentType,
        }),

        payoutEligible: isPayoutEligible({
          adjustedNetAmountCents: displayNetAmountCents,
          cashPreservedRefund,
        }),

        ride: t.ride
          ? {
              id: t.ride.id,
              departureTime: toIso(t.ride.departureTime as Date | null | undefined),
              originCity: t.ride.originCity ?? null,
              destinationCity: t.ride.destinationCity ?? null,
              status: t.ride.status ?? null,
            }
          : null,
      };
    });

    const grossAmountCents = allTransactions.reduce(
      (sum, t) => sum + (t.grossAmountCents || 0),
      0
    );
    const serviceFeeCents = allTransactions.reduce(
      (sum, t) => sum + (t.serviceFeeCents || 0),
      0
    );
    const netAmountCents = allTransactions.reduce(
      (sum, t) => sum + (t.netAmountCents || 0),
      0
    );

    const paidPayoutAmountCents = payouts
      .filter((p) => String(p.status).toUpperCase() === "PAID")
      .reduce((sum, p) => sum + p.amountCents, 0);

    const payoutEligibleNetAmountCents = allTransactions
      .filter((t) => t.payoutEligible)
      .reduce((sum, t) => sum + (t.netAmountCents || 0), 0);

    const pendingNetAmountCents = Math.max(
      0,
      payoutEligibleNetAmountCents - paidPayoutAmountCents
    );

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
        rideCount: allTransactions.length,
      },
      earningsSummary: {
        grossAmountCents,
        serviceFeeCents,
        netAmountCents,
        pendingNetAmountCents,
        paidNetAmountCents: paidPayoutAmountCents,
        rideCount: allTransactions.length,
      },
      transactions: allTransactions,
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
  } catch (err: unknown) {
    console.error("Driver billing API error:", err);
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load driver billing",
    });
  }
}
