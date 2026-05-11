// OATH: Clean replacement file
// FILE: lib/payouts/buildDriverPayoutView.ts

import { prisma } from "@/lib/prisma";
import {
  BookingStatus,
  DisputeStatus,
  PaymentType,
  RefundStatus,
  RidePaymentStatus,
  RideStatus,
} from "@prisma/client";

export type LedgerSettlementType =
  | "CARD_PAYOUT"
  | "CASH_COLLECTED"
  | "CASH_PRESERVED"
  | "REFUND_ADJUSTED"
  | "UNKNOWN";

export type DriverBillingRow = {
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

  driverDisputeFeeCents: number;
  netAfterDisputeFeeCents: number;

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

export type DriverPayoutWeek = {
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

  driverDisputeFeeCents: number;
  netAfterDisputeFeeCents: number;

  cashRideServiceFeeOffsetCents: number;
  finalTransferAmountCents: number;

  rides: DriverBillingRow[];
};

export type DriverBillingView = {
  driver: {
    id: string;
    name: string | null;
    email: string;
    stripeConnectedAccountId: string | null;
    stripePayoutsEnabled: boolean;
    stripeChargesEnabled: boolean;
    stripeAccountReady: boolean;
    externalBankLast4: string | null;
    externalBankName: string | null;
  };
  payouts: {
    id: string;
    amountCents: number;
    currency: string;
    status: string;
    provider: string;
    providerRef: string | null;
    payoutWeekKey: string | null;
    payoutWeekStart: string | null;
    payoutWeekEnd: string | null;
    cardPayableNetAmountCents: number;
    cashRideServiceFeeOffsetCents: number;
    driverDisputeFeeCents: number;
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
    refundFeeChargedToDriverCents: number;
    netAfterDisputeFeeCents: number;
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
      driverDisputeFeeCents: number;
      netAfterDisputeFeeCents: number;
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
};

const PLATFORM_FEE_BPS = 1000;

function toIso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

function asNonNegativeCents(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.max(0, Math.round(v))
    : 0;
}

function computeDriverSplit(args: {
  fareAmountCents: number;
  tipAmountCents?: number;
}) {
  const fareAmountCents = asNonNegativeCents(args.fareAmountCents);
  const tipAmountCents = asNonNegativeCents(args.tipAmountCents);

  const grossAmountCents = fareAmountCents + tipAmountCents;

  // Platform fee applies to ride fare only. Tip passes through to driver.
  const serviceFeeCents = Math.round(
    fareAmountCents * (PLATFORM_FEE_BPS / 10000)
  );

  const netAmountCents = Math.max(
    0,
    fareAmountCents - serviceFeeCents + tipAmountCents
  );

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

function deriveTipAmountCents(payment: any): number {
  const tipStatus = String(payment?.tipStatus ?? "").toUpperCase();

  if (tipStatus !== "SUCCEEDED" && tipStatus !== "PENDING") {
    return 0;
  }

  return asNonNegativeCents(payment?.tipAmountCents);
}

function deriveFareAmountCents(args: {
  latestPayment: any;
  booking: any;
  rideEstimateCents: number;
  tipAmountCents: number;
}) {
  const { latestPayment, booking, rideEstimateCents, tipAmountCents } = args;

  const baseMinusDiscount = Math.max(
    0,
    asNonNegativeCents(latestPayment?.baseAmountCents ?? booking.baseAmountCents) -
      asNonNegativeCents(latestPayment?.discountCents)
  );

  if (baseMinusDiscount > 0) return baseMinusDiscount;

  const paymentFinalMinusTip = Math.max(
    0,
    asNonNegativeCents(latestPayment?.finalAmountCents) - tipAmountCents
  );

  if (paymentFinalMinusTip > 0) return paymentFinalMinusTip;

  const bookingFinalMinusTip = Math.max(
    0,
    asNonNegativeCents(booking.finalAmountCents) - tipAmountCents
  );

  if (bookingFinalMinusTip > 0) return bookingFinalMinusTip;

  return rideEstimateCents;
}

function computeRefundAdjustedSplit(args: {
  bookingFinalAmountCents: number;
  refundAmountCents: number;
  tipAmountCents: number;
}) {
  const adjustedGrossAfterRefundCents = Math.max(
    0,
    args.bookingFinalAmountCents - args.refundAmountCents
  );

  const adjustedTipAmountCents =
    adjustedGrossAfterRefundCents >= args.tipAmountCents
      ? args.tipAmountCents
      : 0;

  const adjustedFareAmountCents = Math.max(
    0,
    adjustedGrossAfterRefundCents - adjustedTipAmountCents
  );

  return computeDriverSplit({
    fareAmountCents: adjustedFareAmountCents,
    tipAmountCents: adjustedTipAmountCents,
  });
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

    driverDisputeFeeCents: 0,
    netAfterDisputeFeeCents: 0,

    cashRideServiceFeeOffsetCents: 0,
    finalTransferAmountCents: 0,

    rides: [],
  };
}

export async function buildDriverPayoutView(
  userId: string
): Promise<DriverBillingView> {
  const driver = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      stripeConnectedAccountId: true,
      stripePayoutsEnabled: true,
      stripeChargesEnabled: true,
      stripeAccountReady: true,
      externalBankLast4: true,
      externalBankName: true,
    },
  });

  if (!driver || driver.role !== "DRIVER") {
    throw new Error("Driver not found");
  }

  const payouts = await prisma.payout.findMany({
    where: { driverId: userId },
    orderBy: [{ payoutWeekStart: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      amountCents: true,
      currency: true,
      status: true,
      provider: true,
      providerRef: true,
      payoutWeekKey: true,
      payoutWeekStart: true,
      payoutWeekEnd: true,
      cardPayableNetAmountCents: true,
      cashRideServiceFeeOffsetCents: true,
      driverDisputeFeeCents: true,
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

  const latestBookingByRideId = new Map<string, any>();

  for (const booking of bookings) {
    if (!latestBookingByRideId.has(booking.rideId)) {
      latestBookingByRideId.set(booking.rideId, booking);
    }
  }

  const uniqueBookings = Array.from(latestBookingByRideId.values());
  const rideIds = uniqueBookings.map((booking) => booking.rideId);

  const ridePayments = rideIds.length
    ? await prisma.ridePayment.findMany({
        where: {
          rideId: { in: rideIds },
          status: {
            in: [
              RidePaymentStatus.AUTHORIZED,
              RidePaymentStatus.PENDING,
              RidePaymentStatus.SUCCEEDED,
            ],
          },
        },
        orderBy: { createdAt: "desc" },
        select: {
          rideId: true,
          baseAmountCents: true,
          discountCents: true,
          finalAmountCents: true,
          tipAmountCents: true,
          tipPercent: true,
          tipStatus: true,
        },
      })
    : [];

  const latestPaymentByRideId = new Map<string, any>();

  for (const payment of ridePayments) {
    if (!latestPaymentByRideId.has(payment.rideId)) {
      latestPaymentByRideId.set(payment.rideId, payment);
    }
  }

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
          ridePaymentId: true,
          refundAmountCents: true,
          refundIssuedAt: true,
        },
      })
    : [];

  const ridePaymentIds = disputes
    .map((d) => d.ridePaymentId)
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0);

  const refunds = ridePaymentIds.length
    ? await prisma.refund.findMany({
        where: {
          ridePaymentId: { in: ridePaymentIds },
          status: RefundStatus.SUCCEEDED,
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          ridePaymentId: true,
          processorFeeLostCents: true,
          amountCents: true,
          createdAt: true,
        },
      })
    : [];

  const refundFeeLostByRidePaymentId = new Map<string, number>();

  for (const refund of refunds) {
    if (!refundFeeLostByRidePaymentId.has(refund.ridePaymentId)) {
      refundFeeLostByRidePaymentId.set(
        refund.ridePaymentId,
        asNonNegativeCents(refund.processorFeeLostCents)
      );
    }
  }

  const disputeByRideId = new Map<
    string,
    {
      refundAmountCents: number;
      refundIssuedAt: Date | null;
      ridePaymentId: string | null;
      processorFeeLostCents: number;
    }
  >();

  for (const dispute of disputes) {
    if (!disputeByRideId.has(dispute.rideId)) {
      const ridePaymentId =
        typeof dispute.ridePaymentId === "string" && dispute.ridePaymentId.trim()
          ? dispute.ridePaymentId
          : null;

      disputeByRideId.set(dispute.rideId, {
        refundAmountCents: asNonNegativeCents(dispute.refundAmountCents),
        refundIssuedAt: dispute.refundIssuedAt ?? null,
        ridePaymentId,
        processorFeeLostCents: ridePaymentId
          ? asNonNegativeCents(
              refundFeeLostByRidePaymentId.get(ridePaymentId) ?? 0
            )
          : 0,
      });
    }
  }

  const allTransactions: DriverBillingRow[] = [];

  for (const booking of uniqueBookings) {
    const ride = booking.ride;
    if (!ride?.departureTime) continue;

    const latestPayment = latestPaymentByRideId.get(booking.rideId);
    const rideEstimateCents = asNonNegativeCents(ride.totalPriceCents);

    const tipAmountCents = deriveTipAmountCents(latestPayment);

    const fareAmountCents = deriveFareAmountCents({
      latestPayment,
      booking,
      rideEstimateCents,
      tipAmountCents,
    });

    const bookingFinalAmountCents = fareAmountCents + tipAmountCents;

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

    const originalSplit = computeDriverSplit({
      fareAmountCents,
      tipAmountCents,
    });

    let displayGrossAmountCents = originalSplit.grossAmountCents;
    let displayServiceFeeCents = originalSplit.serviceFeeCents;
    let displayNetAmountCents = originalSplit.netAmountCents;

    if (cashPreservedRefund) {
      displayGrossAmountCents = originalSplit.grossAmountCents;
      displayServiceFeeCents = originalSplit.serviceFeeCents;
      displayNetAmountCents = originalSplit.netAmountCents;
    } else if (refundIssued) {
      const adjustedSplit = computeRefundAdjustedSplit({
        bookingFinalAmountCents,
        refundAmountCents,
        tipAmountCents,
      });

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

    const driverDisputeFeeCents =
      settlementType === "CASH_PRESERVED" && refundIssued
        ? asNonNegativeCents(dispute?.processorFeeLostCents)
        : 0;

    const netAfterDisputeFeeCents = Math.max(
      0,
      displayNetAmountCents - driverDisputeFeeCents
    );

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

      driverDisputeFeeCents,
      netAfterDisputeFeeCents,

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

  const refundFeeChargedToDriverCents = allTransactions.reduce(
    (sum, tx) => sum + tx.driverDisputeFeeCents,
    0
  );

  const netAfterDisputeFeeCents = allTransactions.reduce(
    (sum, tx) => sum + tx.netAfterDisputeFeeCents,
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

    week.driverDisputeFeeCents += tx.driverDisputeFeeCents;
    week.netAfterDisputeFeeCents += tx.netAfterDisputeFeeCents;
  }

  const payoutsByWeekKey = new Map<
    string,
    {
      id: string;
      status: "PAID" | "PENDING" | "NONE";
      amountCents: number;
      createdAt: string | null;
    }
  >();

  for (const payout of payouts) {
    const key =
      typeof payout.payoutWeekKey === "string" ? payout.payoutWeekKey.trim() : "";

    if (!key || payoutsByWeekKey.has(key)) continue;

    const statusUpper = String(payout.status).toUpperCase();

    const mappedStatus: "PAID" | "PENDING" | "NONE" =
      statusUpper === "PAID"
        ? "PAID"
        : statusUpper === "PENDING"
          ? "PENDING"
          : "NONE";

    payoutsByWeekKey.set(key, {
      id: payout.id,
      status: mappedStatus,
      amountCents: payout.amountCents,
      createdAt: payout.createdAt.toISOString(),
    });
  }

  const weeklyPayouts = Array.from(weeklyMap.values())
    .map((week) => {
      week.cashRideServiceFeeOffsetCents =
        week.cashCollectedServiceFeeCents + week.cashPreservedServiceFeeCents;

      week.finalTransferAmountCents = Math.max(
        0,
        week.cardPayableNetAmountCents -
          week.cashRideServiceFeeOffsetCents -
          week.driverDisputeFeeCents
      );

      const savedPayout = payoutsByWeekKey.get(week.key);

      if (savedPayout) {
        week.payoutId = savedPayout.id;
        week.payoutStatus = savedPayout.status;
        week.payoutAmountCents = savedPayout.amountCents;
        week.payoutCreatedAt = savedPayout.createdAt;
      } else {
        week.payoutAmountCents = week.finalTransferAmountCents;
      }

      return week;
    })
    .sort((a, b) => {
      return new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime();
    });

  const lastPaidWeek =
    weeklyPayouts.find((week) => week.payoutStatus === "PAID") ?? null;

  const currentPendingWeek =
    weeklyPayouts.find(
      (week) =>
        week.finalTransferAmountCents > 0 &&
        week.payoutStatus !== "PAID" &&
        !week.payoutId
    ) ?? null;

  const defaultWeekKey =
    lastPaidWeek?.key ?? currentPendingWeek?.key ?? weeklyPayouts[0]?.key ?? null;

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

  return {
    driver: {
      id: driver.id,
      name: driver.name ?? null,
      email: driver.email,
      stripeConnectedAccountId: driver.stripeConnectedAccountId ?? null,
      stripePayoutsEnabled: driver.stripePayoutsEnabled,
      stripeChargesEnabled: driver.stripeChargesEnabled,
      stripeAccountReady: driver.stripeAccountReady,
      externalBankLast4: driver.externalBankLast4 ?? null,
      externalBankName: driver.externalBankName ?? null,
    },
    payouts: payouts.map((payout) => ({
      id: payout.id,
      amountCents: payout.amountCents,
      currency: payout.currency,
      status: String(payout.status),
      provider: payout.provider,
      providerRef: payout.providerRef ?? null,
      payoutWeekKey: payout.payoutWeekKey ?? null,
      payoutWeekStart: toIso(payout.payoutWeekStart),
      payoutWeekEnd: toIso(payout.payoutWeekEnd),
      cardPayableNetAmountCents: payout.cardPayableNetAmountCents,
      cashRideServiceFeeOffsetCents: payout.cashRideServiceFeeOffsetCents,
      driverDisputeFeeCents: payout.driverDisputeFeeCents,
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
      refundFeeChargedToDriverCents,
      netAfterDisputeFeeCents,
    },
    transactions: allTransactions,
    weeklyPayouts,
    payoutView: {
      defaultWeekKey,
      lastPaidWeekKey: lastPaidWeek?.key ?? null,
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
        driverDisputeFeeCents: week.driverDisputeFeeCents,
        netAfterDisputeFeeCents: week.netAfterDisputeFeeCents,
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
  };
}