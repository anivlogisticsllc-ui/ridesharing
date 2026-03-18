// app/receipt/[bookingId]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DisputeStatus, PaymentType, RideStatus } from "@prisma/client";
import EmailReceiptButton from "./EmailReceiptButton";
import PrintButton from "./PrintButton";
import AutoPrint from "./AutoPrint";

type Props = {
  params: Promise<{ bookingId: string }>;
};

function moneyFromCents(cents: number | null | undefined) {
  const v = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  return (v / 100).toFixed(2);
}

function clampCents(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

function paymentLabel(pt: PaymentType | null | undefined): string | null {
  if (pt === PaymentType.CARD) return "CARD";
  if (pt === PaymentType.CASH) return "CASH";
  return null;
}

export default async function ReceiptPage({ params }: Props) {
  const { bookingId } = await params;
  if (!bookingId) notFound();

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      rider: true,
      ride: {
        include: {
          driver: true,
        },
      },
    },
  });

  if (!booking?.ride) notFound();

  const ride = booking.ride;

  if (ride.status !== RideStatus.COMPLETED) {
    return (
      <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
        <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
          <h1 className="text-xl font-semibold text-slate-900">Receipt</h1>
          <p className="text-sm text-slate-600">
            Receipt is only available once the ride is completed.
          </p>
          <Link className="text-sm text-indigo-600 hover:underline" href="/">
            Go back
          </Link>
        </div>
      </main>
    );
  }

  const dispute = await prisma.dispute.findFirst({
    where: {
      bookingId: booking.id,
      rideId: ride.id,
      status: DisputeStatus.RESOLVED_RIDER,
      refundIssued: true,
    },
    orderBy: {
      refundIssuedAt: "desc",
    },
    select: {
      id: true,
      refundIssued: true,
      refundAmountCents: true,
      refundIssuedAt: true,
      resolvedAt: true,
      adminNotes: true,
    },
  });

  const distance = ride.distanceMiles ?? null;

  const fallbackCharged = Boolean(booking.cashNotPaidAt && booking.fallbackCardChargedAt);
  const originallyCash = booking.originalPaymentType === PaymentType.CASH;
  const switchedToCardFallback =
    originallyCash && booking.paymentType === PaymentType.CARD && fallbackCharged;

  const storedBase =
    typeof booking.baseAmountCents === "number" && booking.baseAmountCents > 0
      ? booking.baseAmountCents
      : ride.totalPriceCents ?? 0;

  const storedDiscount =
    switchedToCardFallback
      ? 0
      : typeof booking.discountCents === "number"
        ? booking.discountCents
        : 0;

  const storedFinal =
    typeof booking.finalAmountCents === "number" && booking.finalAmountCents > 0
      ? booking.finalAmountCents
      : Math.max(0, storedBase - storedDiscount);

  const netAfterDiscount = Math.max(0, storedBase - storedDiscount);
  const fee = Math.max(0, storedFinal - netAfterDiscount);

  const baseCents = clampCents(storedBase);
  const discountCents = clampCents(storedDiscount);
  const finalCents = clampCents(storedFinal);
  const convenienceFeeCents = clampCents(fee);

  const refundAmountCents = Math.min(clampCents(dispute?.refundAmountCents), finalCents);
  const refundedAfterDispute = Boolean(dispute?.refundIssued && refundAmountCents > 0);
  const netCardResultCents = Math.max(0, finalCents - refundAmountCents);

  let displayedPaymentLabel: string | null = null;

  if (switchedToCardFallback && refundedAfterDispute) {
    displayedPaymentLabel = "CARD (fallback after unpaid CASH, later refunded)";
  } else if (switchedToCardFallback) {
    displayedPaymentLabel = "CARD (fallback after unpaid CASH)";
  } else if (originallyCash && booking.paymentType === PaymentType.CASH) {
    displayedPaymentLabel = "CASH";
  } else {
    displayedPaymentLabel = paymentLabel(booking.paymentType) ?? "n/a";
  }

  const showDiscount = discountCents > 0;
  const showFee = convenienceFeeCents > 0;

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 print:min-h-0 print:bg-white">
      <AutoPrint />

      <style>{`
        @page {
          size: portrait;
          margin: 8mm;
        }

        @media print {
          html, body {
            background: #ffffff !important;
            margin: 0 !important;
            padding: 0 !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          body * {
            visibility: hidden !important;
          }

          #print-receipt,
          #print-receipt * {
            visibility: visible !important;
          }

          main {
            min-height: 0 !important;
            height: auto !important;
            background: #ffffff !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          #print-receipt {
            position: static !important;
            width: 210mm !important;
            max-width: 210mm !important;
            margin: 0 auto !important;
            padding: 0 !important;
            background: #ffffff !important;
            zoom: 1.15;
            transform-origin: top center;
          }

          .print-hide {
            display: none !important;
          }

          .print-card {
            box-shadow: none !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          .print-no-break {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          .print-compact {
            margin: 0 !important;
            padding-top: 0 !important;
            padding-bottom: 0 !important;
          }

          .print-title {
            font-size: 20px !important;
            line-height: 1.2 !important;
          }

          .print-body {
            font-size: 13px !important;
            line-height: 1.45 !important;
          }

          .print-small {
            font-size: 12px !important;
            line-height: 1.35 !important;
          }

          .print-tiny {
            font-size: 11px !important;
            line-height: 1.3 !important;
          }
        }
      `}</style>

      <div
        id="print-receipt"
        className="mx-auto max-w-2xl space-y-6 px-4 py-10 print-compact print:px-0 print:py-0"
      >
        <div className="print-hide flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 print-title">Ride receipt</h1>
            <p className="text-xs text-slate-500 print-tiny">
              Booking ID: <span className="font-mono">{booking.id}</span>
            </p>

            {switchedToCardFallback ? (
              <p className="mt-1 text-[11px] text-slate-500 print-tiny">
                Originally booked as cash. Driver reported cash was not received, and the saved
                card was charged.
              </p>
            ) : null}

            {refundedAfterDispute ? (
              <p className="mt-1 text-[11px] text-emerald-700 print-tiny">
                A dispute refund was later recorded for this fallback card charge.
              </p>
            ) : null}
          </div>

          <div className="print-hide flex flex-col items-end gap-2">
            <PrintButton />
            <EmailReceiptButton bookingId={booking.id} apiPath="/api/receipt/email" />
          </div>
        </div>

        <div className="hidden print:block">
          <h1 className="text-xl font-semibold text-slate-900 print-title">Ride receipt</h1>
          <p className="text-xs text-slate-500 print-tiny">
            Booking ID: <span className="font-mono">{booking.id}</span>
          </p>

          {switchedToCardFallback ? (
            <p className="mt-1 text-[11px] text-slate-500 print-tiny">
              Originally booked as cash. Driver reported cash was not received, and the saved card
              was charged.
            </p>
          ) : null}

          {refundedAfterDispute ? (
            <p className="mt-1 text-[11px] text-emerald-700 print-tiny">
              A dispute refund was later recorded for this fallback card charge.
            </p>
          ) : null}
        </div>

        <section className="print-card rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900 print-body">
              {ride.originCity} → {ride.destinationCity}
            </p>
            <p className="text-xs text-slate-500 print-tiny">
              Completed: {ride.tripCompletedAt?.toLocaleString() ?? "n/a"}
            </p>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 print-tiny">
                Rider
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900 print-body">
                {booking.rider?.name || "Unknown"}
              </p>
              <p className="text-xs text-slate-500 print-tiny">{booking.rider?.email || ""}</p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 print-tiny">
                Driver
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900 print-body">
                {ride.driver?.name || "Unknown"}
              </p>
              <p className="text-xs text-slate-500 print-tiny">{ride.driver?.email || ""}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 print-tiny">
                Distance
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900 print-body">
                {distance != null ? `${distance.toFixed(2)} miles` : "n/a"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 print-tiny">
                Passengers
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900 print-body">
                {ride.passengerCount}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 print-tiny">
                Payment
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900 print-body">
                {displayedPaymentLabel ?? "n/a"}
              </p>
            </div>

            <div className="sm:text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 print-tiny">
                {refundedAfterDispute ? "Original total" : "Total"}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900 print-body">
                ${moneyFromCents(finalCents)}
              </p>
              <p className="text-[11px] text-slate-500 print-tiny">
                Stored final: {finalCents} cents
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 print-body">
            <div className="flex items-center justify-between">
              <span>Base fare</span>
              <span className="font-semibold">${moneyFromCents(baseCents)}</span>
            </div>

            <div className="flex items-center justify-between">
              <span>Discount</span>
              <span className="font-semibold">
                {showDiscount ? `-$${moneyFromCents(discountCents)}` : "$0.00"}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span>Convenience fee</span>
              <span className="font-semibold">
                {showFee ? `$${moneyFromCents(convenienceFeeCents)}` : "$0.00"}
              </span>
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
              <span className="font-semibold">Original total</span>
              <span className="font-semibold">${moneyFromCents(finalCents)}</span>
            </div>
          </div>
        </section>

        {switchedToCardFallback ? (
          <section className="print-card print-no-break rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 print-body">
            <p className="font-semibold">Cash fallback charge</p>
            <div className="mt-2 space-y-1 text-xs print-tiny">
              <p>Cash not paid at: {booking.cashNotPaidAt?.toLocaleString() ?? "n/a"}</p>
              <p>
                Cash discount revoked at: {booking.cashDiscountRevokedAt?.toLocaleString() ?? "n/a"}
              </p>
              <p>
                Fallback card charged at: {booking.fallbackCardChargedAt?.toLocaleString() ?? "n/a"}
              </p>
              <p>Reason: {booking.cashNotPaidReason ?? "n/a"}</p>
              {booking.cashNotPaidNote ? <p>Note: {booking.cashNotPaidNote}</p> : null}
            </div>
          </section>
        ) : null}

        {refundedAfterDispute ? (
          <section className="print-card print-no-break rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 print-body">
            <p className="font-semibold">Refund after dispute</p>
            <div className="mt-2 space-y-1 text-xs print-tiny">
              <p>Refund recorded: Yes</p>
              <p>Refund amount: -${moneyFromCents(refundAmountCents)}</p>
              <p>Refund issued at: {dispute?.refundIssuedAt?.toLocaleString() ?? "n/a"}</p>
              <p>Dispute resolved at: {dispute?.resolvedAt?.toLocaleString() ?? "n/a"}</p>
            </div>

            <div className="mt-3 rounded-lg border border-emerald-200 bg-white/80 p-3 print-body">
              <div className="flex items-center justify-between">
                <span>Original fallback charge</span>
                <span className="font-semibold">${moneyFromCents(finalCents)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span>Refund after dispute</span>
                <span className="font-semibold">-${moneyFromCents(refundAmountCents)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-emerald-200 pt-2">
                <span className="font-semibold">Net card result</span>
                <span className="font-semibold">${moneyFromCents(netCardResultCents)}</span>
              </div>
            </div>
          </section>
        ) : null}

        <p className="print-hide text-xs text-slate-500">
          Tip: this page is printable. Use “Print” to save as PDF.
        </p>
      </div>
    </main>
  );
}
