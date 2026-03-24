// OATH: Clean replacement file
// FILE: pages/api/account/billing/driver.ts

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

type LedgerSettlementType =
  | "CARD_PAYOUT"
  | "CASH_COLLECTED"
  | "CASH_PRESERVED"
  | "REFUND_ADJUSTED"
  | "UNKNOWN";

type DriverBillingRow = {
  id: string;
  rideId: string;
  bookingId: string;
  createdAt: string;
  status: string;

  grossAmountCents: number;
  serviceFeeCents: number;
  netAmountCents: number;

  paymentType: "CARD" | "CASH" | "UNKNOWN";
  originalPaymentType: "CARD" | "CASH" | "UNKNOWN";

  settlementType: LedgerSettlementType;
  payoutEligible: boolean;
  exclusionReason: string | null;

  refundIssued: boolean;
  refundAmountCents: number;
  refundIssuedAt: string | null;

  originalGrossAmountCents: number;
  originalServiceFeeCents: number;
  originalNetAmountCents: number;

  payoutWeekKey: string;
  payoutWeekStart: string;
  payoutWeekEnd: string;

  ride: {
    id: string;
    departureTime: string | null;
    originCity: string | null;
    destinationCity: string | null;
    status: string | null;
  } | null;
};

type DriverPayoutWeek = {
  key: string;
  weekStart: string;
  weekEnd: string;
  label: string;

  payoutStatus: "PAID" | "PENDING" | "NONE";
  payoutId: string | null;
  payoutCreatedAt: string | null;
  payoutAmountCents: number;

  includedGrossAmountCents: number;
  includedServiceFeeCents: number;
  includedNetAmountCents: number;

  excludedGrossAmountCents: number;
  excludedServiceFeeCents: number;
  excludedNetAmountCents: number;

  includedRideCount: number;
  excludedRideCount: number;

  cardPayableGrossAmountCents: number;
  cardPayableServiceFeeCents: number;
  cardPayableNetAmountCents: number;

  cashCollectedGrossAmountCents: number;
  cashCollectedServiceFeeCents: number;
  cashCollectedNetAmountCents: number;

  cashPreservedGrossAmountCents: number;
  cashPreservedServiceFeeCents: number;
  cashPreservedNetAmountCents: number;

  refundAdjustedGrossAmountCents: number;
  refundAdjustedServiceFeeCents: number;
  refundAdjustedNetAmountCents: number;

  cashRideServiceFeeOffsetCents: number;
  finalTransferAmountCents: number;

  rides: DriverBillingRow[];
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
        bankPayoutEligibleNetAmountCents: number;
        excludedFromBankPayoutNetAmountCents: number;
      };
      transactions: DriverBillingRow[];
      weeklyPayouts: DriverPayoutWeek[];
      payoutView: {
        defaultWeekKey: string | null;
        lastPaidWeekKey: string | null;
        currentPendingWeekKey: string | null;
        weekOptions: {
          key: string;
          label: string;
          payoutStatus: "PAID" | "PENDING" | "NONE";
          payoutAmountCents: number;
          includedNetAmountCents: number;
          includedRideCount: number;
          excludedRideCount: number;
          finalTransferAmountCents: number;
          cashRideServiceFeeOffsetCents: number;
        }[];
      };
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
  return typeof v === "number" && Number.isFinite(v)
    ? Math.max(0, Math.round(v))
    : 0;
}

function computeDriverSplit(collectedAmountCents: number) {
  const grossAmountCents = Math.max(0, Math.round(collectedAmountCents));
  const serviceFeeCents = Math.round(
    grossAmountCents * (PLATFORM_FEE_BPS / 10000)
  );
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

function deriveSettlementType(args: {
  paymentType: "CARD" | "CASH" | "UNKNOWN";
  originalPaymentType: "CARD" | "CASH" | "UNKNOWN";
  cashPreservedRefund: boolean;
  refundIssued: boolean;
}): LedgerSettlementType {
  if (args.cashPreservedRefund) return "CASH_PRESERVED";
  if (args.paymentType === "CASH" || args.originalPaymentType === "CASH") {
    return "CASH_COLLECTED";
  }
  if (args.refundIssued) return "REFUND_ADJUSTED";
  if (args.paymentType === "CARD") return "CARD_PAYOUT";
  return "UNKNOWN";
}

function deriveExclusionReason(args: {
  payoutEligible: boolean;
  settlementType: LedgerSettlementType;
}) {
  if (args.payoutEligible) return null;

  if (args.settlementType === "CASH_COLLECTED") {
    return "Collected directly in cash";
  }

  if (args.settlementType === "CASH_PRESERVED") {
    return "Cash preserved, no bank payout";
  }

  if (args.settlementType === "REFUND_ADJUSTED") {
    return "Refund adjusted to zero or non-payable amount";
  }

  return "Not payout eligible";
}

function startOfWeekMonday(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diffToMonday = (day + 6) % 7;
  d.setDate(d.getDate() - diffToMonday);
  return d;
}

function endOfWeekSunday(date: Date) {
  const start = startOfWeekMonday(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function formatWeekKey(start: Date) {
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, "0");
  const d = String(start.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatWeekLabel(start: Date, end: Date) {
  const startLabel = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const endLabel = end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startLabel} – ${endLabel}`;
}

function getWeekMeta(date: Date) {
  const weekStart = startOfWeekMonday(date);
  const weekEnd = endOfWeekSunday(date);

  return {
    weekStart,
    weekEnd,
    weekKey: formatWeekKey(weekStart),
    label: formatWeekLabel(weekStart, weekEnd),
  };
}

function emptyWeekTotals(args: {
  key: string;
  weekStart: string;
  weekEnd: string;
  label: string;
}): DriverPayoutWeek {
  return {
    key: args.key,
    weekStart: args.weekStart,
    weekEnd: args.weekEnd,
    label: args.label,

    payoutStatus: "NONE",
    payoutId: null,
    payoutCreatedAt: null,
    payoutAmountCents: 0,

    includedGrossAmountCents: 0,
    includedServiceFeeCents: 0,
    includedNetAmountCents: 0,

    excludedGrossAmountCents: 0,
    excludedServiceFeeCents: 0,
    excludedNetAmountCents: 0,

    includedRideCount: 0,
    excludedRideCount: 0,

    cardPayableGrossAmountCents: 0,
    cardPayableServiceFeeCents: 0,
    cardPayableNetAmountCents: 0,

    cashCollectedGrossAmountCents: 0,
    cashCollectedServiceFeeCents: 0,
    cashCollectedNetAmountCents: 0,

    cashPreservedGrossAmountCents: 0,
    cashPreservedServiceFeeCents: 0,
    cashPreservedNetAmountCents: 0,

    refundAdjustedGrossAmountCents: 0,
    refundAdjustedServiceFeeCents: 0,
    refundAdjustedNetAmountCents: 0,

    cashRideServiceFeeOffsetCents: 0,
    finalTransferAmountCents: 0,

    rides: [],
  };
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

    const bookings = await prisma.booking.findMany({
      where: {
        status: { in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED] },
        ride: {
          driverId: userId,
          status: RideStatus.COMPLETED,
        },
      },
      orderBy: [{ rideId: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        rideId: true,
        createdAt: true,
        updatedAt: true,
        paymentType: true,
        originalPaymentType: true,
        cashNotPaidAt: true,
        fallbackCardChargedAt: true,
        baseAmountCents: true,
        finalAmountCents: true,
        ride: {
          select: {
            id: true,
            departureTime: true,
            originCity: true,
            destinationCity: true,
            status: true,
            totalPriceCents: true,
          },
        },
      },
    });

    const latestBookingByRideId = new Map<string, (typeof bookings)[number]>();
    for (const booking of bookings) {
      if (!latestBookingByRideId.has(booking.rideId)) {
        latestBookingByRideId.set(booking.rideId, booking);
      }
    }

    const uniqueBookings = Array.from(latestBookingByRideId.values());
    const rideIds = uniqueBookings.map((booking) => booking.rideId);

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

    const disputeByRideId = new Map<
      string,
      {
        refundAmountCents: number;
        refundIssuedAt: Date | null;
      }
    >();

    for (const dispute of disputes) {
      if (!disputeByRideId.has(dispute.rideId)) {
        disputeByRideId.set(dispute.rideId, {
          refundAmountCents: asNonNegativeCents(dispute.refundAmountCents),
          refundIssuedAt: dispute.refundIssuedAt ?? null,
        });
      }
    }

    const allTransactions: DriverBillingRow[] = [];

    for (const booking of uniqueBookings) {
      const ride = booking.ride;
      if (!ride?.departureTime) continue;

      const rideEstimateCents = asNonNegativeCents(ride.totalPriceCents);
      const bookingFinalAmountCents =
        asNonNegativeCents(booking.finalAmountCents) || rideEstimateCents;

      const dispute = disputeByRideId.get(booking.rideId);
      const refundAmountCents = Math.min(
        asNonNegativeCents(dispute?.refundAmountCents),
        bookingFinalAmountCents
      );
      const refundIssued = refundAmountCents > 0;

      const cashPreservedRefund = isCashPreservedRefund({
        originalPaymentType: booking.originalPaymentType,
        paymentType: booking.paymentType,
        cashNotPaidAt: booking.cashNotPaidAt,
        fallbackCardChargedAt: booking.fallbackCardChargedAt,
        refundAmountCents,
      });

      const originalSplit = computeDriverSplit(bookingFinalAmountCents);

      let displayGrossAmountCents = originalSplit.grossAmountCents;
      let displayServiceFeeCents = originalSplit.serviceFeeCents;
      let displayNetAmountCents = originalSplit.netAmountCents;

      if (cashPreservedRefund) {
        displayGrossAmountCents = originalSplit.grossAmountCents;
        displayServiceFeeCents = originalSplit.serviceFeeCents;
        displayNetAmountCents = originalSplit.netAmountCents;
      } else if (refundIssued) {
        const adjustedBase = Math.max(
          0,
          bookingFinalAmountCents - refundAmountCents
        );
        const adjustedSplit = computeDriverSplit(adjustedBase);
        displayGrossAmountCents = adjustedSplit.grossAmountCents;
        displayServiceFeeCents = adjustedSplit.serviceFeeCents;
        displayNetAmountCents = adjustedSplit.netAmountCents;
      }

      const paymentType = deriveDriverPaymentType({
        paymentType: booking.paymentType,
      });

      const originalPaymentType = deriveDriverPaymentType({
        paymentType: booking.originalPaymentType,
      });

      const settlementType = deriveSettlementType({
        paymentType,
        originalPaymentType,
        cashPreservedRefund,
        refundIssued,
      });

      const payoutEligible =
        settlementType === "CARD_PAYOUT" &&
        asNonNegativeCents(displayNetAmountCents) > 0;

      const exclusionReason = deriveExclusionReason({
        payoutEligible,
        settlementType,
      });

      const weekMeta = getWeekMeta(ride.departureTime);

      allTransactions.push({
        id: booking.id,
        bookingId: booking.id,
        rideId: booking.rideId,
        createdAt: booking.createdAt.toISOString(),
        status: refundIssued ? "REFUNDED" : String(ride.status).toUpperCase(),

        grossAmountCents: displayGrossAmountCents,
        serviceFeeCents: displayServiceFeeCents,
        netAmountCents: displayNetAmountCents,

        originalGrossAmountCents: originalSplit.grossAmountCents,
        originalServiceFeeCents: originalSplit.serviceFeeCents,
        originalNetAmountCents: originalSplit.netAmountCents,

        refundIssued,
        refundAmountCents,
        refundIssuedAt: toIso(dispute?.refundIssuedAt),

        paymentType,
        originalPaymentType,

        settlementType,
        payoutEligible,
        exclusionReason,

        payoutWeekKey: weekMeta.weekKey,
        payoutWeekStart: weekMeta.weekStart.toISOString(),
        payoutWeekEnd: weekMeta.weekEnd.toISOString(),

        ride: {
          id: ride.id,
          departureTime: toIso(ride.departureTime),
          originCity: ride.originCity ?? null,
          destinationCity: ride.destinationCity ?? null,
          status: ride.status ? String(ride.status) : null,
        },
      });
    }

    allTransactions.sort((a, b) => {
      const aTime = new Date(a.ride?.departureTime ?? a.createdAt).getTime();
      const bTime = new Date(b.ride?.departureTime ?? b.createdAt).getTime();
      return bTime - aTime;
    });

    const grossAmountCents = allTransactions.reduce(
      (sum, tx) => sum + tx.grossAmountCents,
      0
    );
    const serviceFeeCents = allTransactions.reduce(
      (sum, tx) => sum + tx.serviceFeeCents,
      0
    );
    const netAmountCents = allTransactions.reduce(
      (sum, tx) => sum + tx.netAmountCents,
      0
    );

    const bankPayoutEligibleNetAmountCents = allTransactions
      .filter((tx) => tx.payoutEligible)
      .reduce((sum, tx) => sum + tx.netAmountCents, 0);

    const excludedFromBankPayoutNetAmountCents = allTransactions
      .filter((tx) => !tx.payoutEligible)
      .reduce((sum, tx) => sum + tx.netAmountCents, 0);

    const paidPayoutAmountCents = payouts
      .filter((payout) => String(payout.status).toUpperCase() === "PAID")
      .reduce((sum, payout) => sum + payout.amountCents, 0);

    const pendingNetAmountCents = Math.max(
      0,
      bankPayoutEligibleNetAmountCents - paidPayoutAmountCents
    );

    const weeklyMap = new Map<string, DriverPayoutWeek>();

    for (const tx of allTransactions) {
      if (!weeklyMap.has(tx.payoutWeekKey)) {
        weeklyMap.set(
          tx.payoutWeekKey,
          emptyWeekTotals({
            key: tx.payoutWeekKey,
            weekStart: tx.payoutWeekStart,
            weekEnd: tx.payoutWeekEnd,
            label: formatWeekLabel(
              new Date(tx.payoutWeekStart),
              new Date(tx.payoutWeekEnd)
            ),
          })
        );
      }

      const week = weeklyMap.get(tx.payoutWeekKey)!;
      week.rides.push(tx);

      if (tx.payoutEligible) {
        week.includedGrossAmountCents += tx.grossAmountCents;
        week.includedServiceFeeCents += tx.serviceFeeCents;
        week.includedNetAmountCents += tx.netAmountCents;
        week.includedRideCount += 1;
      } else {
        week.excludedGrossAmountCents += tx.grossAmountCents;
        week.excludedServiceFeeCents += tx.serviceFeeCents;
        week.excludedNetAmountCents += tx.netAmountCents;
        week.excludedRideCount += 1;
      }

      switch (tx.settlementType) {
        case "CARD_PAYOUT":
          week.cardPayableGrossAmountCents += tx.grossAmountCents;
          week.cardPayableServiceFeeCents += tx.serviceFeeCents;
          week.cardPayableNetAmountCents += tx.netAmountCents;
          break;

        case "CASH_COLLECTED":
          week.cashCollectedGrossAmountCents += tx.grossAmountCents;
          week.cashCollectedServiceFeeCents += tx.serviceFeeCents;
          week.cashCollectedNetAmountCents += tx.netAmountCents;
          break;

        case "CASH_PRESERVED":
          week.cashPreservedGrossAmountCents += tx.grossAmountCents;
          week.cashPreservedServiceFeeCents += tx.serviceFeeCents;
          week.cashPreservedNetAmountCents += tx.netAmountCents;
          break;

        case "REFUND_ADJUSTED":
          week.refundAdjustedGrossAmountCents += tx.grossAmountCents;
          week.refundAdjustedServiceFeeCents += tx.serviceFeeCents;
          week.refundAdjustedNetAmountCents += tx.netAmountCents;
          break;

        default:
          break;
      }
    }

    const weeklyPayouts = Array.from(weeklyMap.values())
      .map((week) => {
        week.cashRideServiceFeeOffsetCents =
          week.cashCollectedServiceFeeCents + week.cashPreservedServiceFeeCents;

        week.finalTransferAmountCents = Math.max(
          0,
          week.cardPayableNetAmountCents - week.cashRideServiceFeeOffsetCents
        );

        return week;
      })
      .sort((a, b) => {
        return new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime();
      });

    const lastPaidWeek: DriverPayoutWeek | null = null;

    const currentPendingWeek =
      weeklyPayouts.find((week) => week.finalTransferAmountCents > 0) ?? null;

    const defaultWeekKey =
      currentPendingWeek?.key ?? weeklyPayouts[0]?.key ?? null;

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
      payouts: payouts.map((payout) => ({
        id: payout.id,
        amountCents: payout.amountCents,
        currency: payout.currency,
        status: String(payout.status),
        createdAt: payout.createdAt.toISOString(),
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
        bankPayoutEligibleNetAmountCents,
        excludedFromBankPayoutNetAmountCents,
      },
      transactions: allTransactions,
      weeklyPayouts,
      payoutView: {
        defaultWeekKey,
        lastPaidWeekKey: null,
        currentPendingWeekKey: currentPendingWeek?.key ?? null,
        weekOptions: weeklyPayouts.map((week) => ({
          key: week.key,
          label: week.label,
          payoutStatus: week.payoutStatus,
          payoutAmountCents: week.payoutAmountCents,
          includedNetAmountCents: week.includedNetAmountCents,
          includedRideCount: week.includedRideCount,
          excludedRideCount: week.excludedRideCount,
          finalTransferAmountCents: week.finalTransferAmountCents,
          cashRideServiceFeeOffsetCents: week.cashRideServiceFeeOffsetCents,
        })),
      },
      membershipCharges: membershipCharges.map((charge) => ({
        id: charge.id,
        amountCents: charge.amountCents,
        currency: charge.currency,
        status: String(charge.status),
        createdAt: charge.createdAt.toISOString(),
        paidAt: toIso(charge.paidAt),
        failedAt: toIso(charge.failedAt),
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