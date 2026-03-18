// app/driver/rides/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BookingStatus, DisputeStatus, RideStatus, PaymentType } from "@prisma/client";

type Props = { params: Promise<{ id: string }> };

const PLATFORM_FEE_BPS = 1000;

function money(cents: number | null | undefined) {
  const v = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  return (v / 100).toFixed(2);
}

function normalizeCents(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

function computeDriverSplit(grossAmountCents: number) {
  const gross = Math.max(0, Math.round(grossAmountCents));
  const fee = Math.round(gross * (PLATFORM_FEE_BPS / 10000));
  const net = Math.max(0, gross - fee);

  return {
    grossAmountCents: gross,
    serviceFeeCents: fee,
    netAmountCents: net,
  };
}

export default async function RideDetailPage({ params }: Props) {
  const { id } = await params;
  if (!id) notFound();

  const ride = await prisma.ride.findUnique({
    where: { id },
    include: {
      rider: true,
      driver: true,
      conversations: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { id: true },
      },
    },
  });

  if (!ride) notFound();

  const booking = await prisma.booking.findFirst({
    where: {
      rideId: id,
      status: { in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED] },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      paymentType: true,
      originalPaymentType: true,
      cashDiscountBps: true,
      baseAmountCents: true,
      discountCents: true,
      finalAmountCents: true,
      cashNotPaidAt: true,
      cashDiscountRevokedAt: true,
      cashNotPaidReason: true,
      cashNotPaidNote: true,
      fallbackCardChargedAt: true,
    },
  });

  const dispute = booking
    ? await prisma.dispute.findFirst({
        where: {
          bookingId: booking.id,
          rideId: id,
          status: DisputeStatus.RESOLVED_RIDER,
          refundIssued: true,
        },
        orderBy: {
          refundIssuedAt: "desc",
        },
        select: {
          id: true,
          status: true,
          refundIssued: true,
          refundAmountCents: true,
          refundIssuedAt: true,
          resolvedAt: true,
          adminNotes: true,
        },
      })
    : null;

  const conversationId = ride.conversations?.[0]?.id ?? null;

  const isCompletedOrCancelled =
    ride.status === RideStatus.COMPLETED || ride.status === RideStatus.CANCELLED;

  const chatHref = conversationId
    ? `/chat/${conversationId}?role=driver${isCompletedOrCancelled ? "&readonly=1" : ""}`
    : null;

  const receiptHref =
    ride.status === RideStatus.COMPLETED && booking?.id
      ? `/receipt/${booking.id}?autoprint=1`
      : null;

  const startedAt = ride.tripStartedAt ?? ride.departureTime;
  const completedAt = ride.tripCompletedAt ?? ride.updatedAt;

  const durationMs =
    ride.tripStartedAt && ride.tripCompletedAt
      ? ride.tripCompletedAt.getTime() - ride.tripStartedAt.getTime()
      : 0;

  const durationMinutes = durationMs > 0 ? durationMs / 1000 / 60 : 0;

  function formatDuration(minutes: number) {
    if (minutes <= 0) return "n/a";
    const totalMinutes = Math.round(minutes);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours === 0) return `${mins} min`;
    return `${hours}h ${mins}m`;
  }

  const distanceMiles = ride.distanceMiles ?? 0;

  const rideEstimateCents = normalizeCents((ride as any).totalPriceCents);
  const baseCents = normalizeCents(booking?.baseAmountCents ?? rideEstimateCents);
  const discountCents = normalizeCents(booking?.discountCents ?? 0);

  const finalCents =
    normalizeCents(booking?.finalAmountCents) ||
    Math.max(0, baseCents - discountCents) ||
    rideEstimateCents;

  const convenienceFeeCents = Math.max(0, finalCents - Math.max(0, baseCents - discountCents));

  const fallbackCharged = Boolean(booking?.cashNotPaidAt && booking?.fallbackCardChargedAt);
  const originallyCash = booking?.originalPaymentType === PaymentType.CASH;
  const switchedToCardFallback =
    originallyCash && booking?.paymentType === PaymentType.CARD && fallbackCharged;

  const refundAmountCents = Math.min(normalizeCents(dispute?.refundAmountCents), finalCents);
  const refundedAfterDispute = Boolean(dispute?.refundIssued && refundAmountCents > 0);

  const netCardResultCents = Math.max(0, finalCents - refundAmountCents);

  const originalDriverSplit = computeDriverSplit(finalCents);

  const preservedCashAccounting = switchedToCardFallback && refundedAfterDispute;

  const effectiveDriverSplit = preservedCashAccounting
    ? originalDriverSplit
    : computeDriverSplit(netCardResultCents);

  let paymentLabel =
    booking?.paymentType === PaymentType.CARD
      ? "CARD"
      : booking?.paymentType === PaymentType.CASH
      ? "CASH"
      : "n/a";

  if (preservedCashAccounting) {
    paymentLabel = "CASH preserved (fallback card later refunded)";
  } else if (switchedToCardFallback) {
    paymentLabel = "CARD (fallback after unpaid CASH)";
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <Link
          href="/driver/dashboard"
          className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900"
        >
          <span className="mr-1">←</span>
          Back to dashboard
        </Link>

        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Ride details</h1>
          <p className="text-sm text-slate-600">
            {ride.originCity} → {ride.destinationCity}
          </p>
          <p className="text-xs text-slate-500">
            Ride ID: <span className="font-mono">{ride.id}</span>
          </p>

          <div className="flex flex-wrap gap-2 pt-2">
            {chatHref ? (
              <Link
                href={chatHref}
                className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-900 hover:bg-slate-50"
              >
                View chat {isCompletedOrCancelled ? "(read-only)" : ""}
              </Link>
            ) : (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs text-slate-500">
                No chat available
              </span>
            )}

            {receiptHref ? (
              <Link
                href={receiptHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-full bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
              >
                View receipt
              </Link>
            ) : (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs text-slate-500">
                Receipt not available
              </span>
            )}
          </div>
        </header>

        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Trip status</p>
              <p className="text-sm font-semibold text-slate-900">{ride.status}</p>
            </div>

            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {refundedAfterDispute ? "Original fare" : "Total fare"}
              </p>
              <p className="text-lg font-semibold text-slate-900">${money(finalCents)}</p>
              <p className="text-[11px] text-slate-500">Stored as {finalCents} cents</p>
            </div>
          </div>

          <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Payment</p>
              <p className="mt-1 font-semibold">{paymentLabel}</p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Base fare</p>
              <p className="mt-1 font-semibold">${money(baseCents)}</p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Discount</p>
              <p className="mt-1 font-semibold">
                {discountCents > 0 ? `-$${money(discountCents)}` : "$0.00"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Convenience fee</p>
              <p className="mt-1 font-semibold">
                {convenienceFeeCents > 0 ? `$${money(convenienceFeeCents)}` : "$0.00"}
              </p>
            </div>
          </div>

          <div className="grid gap-4 pt-2 text-sm text-slate-700 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Distance</p>
              <p className="mt-1 font-semibold">
                {distanceMiles > 0 ? `${distanceMiles.toFixed(2)} miles` : "n/a"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Duration</p>
              <p className="mt-1 font-semibold">{formatDuration(durationMinutes)}</p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Passenger count</p>
              <p className="mt-1 font-semibold">{ride.passengerCount}</p>
            </div>
          </div>
        </section>

        {switchedToCardFallback ? (
          <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm text-sm text-amber-950">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-800">
              Cash fallback charge
            </h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-amber-700">Original payment selection</p>
                <p className="mt-1 font-medium">CASH</p>
              </div>
              <div>
                <p className="text-xs text-amber-700">Fallback card charged amount</p>
                <p className="mt-1 font-medium">${money(finalCents)}</p>
              </div>
              <div>
                <p className="text-xs text-amber-700">Cash not paid at</p>
                <p className="mt-1 font-medium">{booking?.cashNotPaidAt?.toLocaleString() ?? "n/a"}</p>
              </div>
              <div>
                <p className="text-xs text-amber-700">Fallback card charged at</p>
                <p className="mt-1 font-medium">{booking?.fallbackCardChargedAt?.toLocaleString() ?? "n/a"}</p>
              </div>
              <div>
                <p className="text-xs text-amber-700">Reason</p>
                <p className="mt-1 font-medium">{booking?.cashNotPaidReason ?? "n/a"}</p>
              </div>
              <div>
                <p className="text-xs text-amber-700">Driver/Admin note</p>
                <p className="mt-1 font-medium">{booking?.cashNotPaidNote ?? "n/a"}</p>
              </div>
            </div>
          </section>
        ) : null}

        {refundedAfterDispute ? (
          <section className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm text-sm text-emerald-950">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
              Refund after dispute
            </h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-emerald-700">Refund recorded</p>
                <p className="mt-1 font-medium">Yes</p>
              </div>
              <div>
                <p className="text-xs text-emerald-700">Refund amount</p>
                <p className="mt-1 font-medium">-${money(refundAmountCents)}</p>
              </div>
              <div>
                <p className="text-xs text-emerald-700">Refund issued at</p>
                <p className="mt-1 font-medium">{dispute?.refundIssuedAt?.toLocaleString() ?? "n/a"}</p>
              </div>
              <div>
                <p className="text-xs text-emerald-700">Dispute resolved at</p>
                <p className="mt-1 font-medium">{dispute?.resolvedAt?.toLocaleString() ?? "n/a"}</p>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-white/70 p-3">
              <div className="flex items-center justify-between">
                <span>Original fallback charge</span>
                <span className="font-semibold">${money(finalCents)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span>Refund after dispute</span>
                <span className="font-semibold">-${money(refundAmountCents)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-emerald-200 pt-2">
                <span className="font-semibold">Net card result</span>
                <span className="font-semibold">${money(netCardResultCents)}</span>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-white/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                Driver payout effect
              </p>
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span>Original driver earnings</span>
                  <span className="font-semibold">${money(originalDriverSplit.netAmountCents)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>
                    {preservedCashAccounting ? "Effective driver earnings (cash preserved)" : "Adjusted driver earnings"}
                  </span>
                  <span className="font-semibold">${money(effectiveDriverSplit.netAmountCents)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Platform fee preserved</span>
                  <span className="font-semibold">${money(originalDriverSplit.serviceFeeCents)}</span>
                </div>
              </div>

              <p className="mt-3 text-xs text-emerald-800">
                {preservedCashAccounting
                  ? "The rider's fallback card charge was refunded, but this ride still counts as cash-preserved for driver earnings and platform fee accounting."
                  : "The refund changed the effective card result and associated driver payout values."}
              </p>
            </div>
          </section>
        ) : null}

        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-sm text-slate-700">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Timing</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-slate-500">Scheduled departure</p>
              <p className="mt-1 font-medium">{ride.departureTime.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Trip started</p>
              <p className="mt-1 font-medium">{startedAt ? startedAt.toLocaleString() : "n/a"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Trip completed</p>
              <p className="mt-1 font-medium">{completedAt ? completedAt.toLocaleString() : "n/a"}</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
