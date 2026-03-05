// app/receipt/[bookingId]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { RideStatus } from "@prisma/client";
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

export default async function ReceiptPage({ params }: Props) {
  const { bookingId } = await params;
  if (!bookingId) notFound();

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      rider: true,
      ride: { include: { driver: true } },
      outstandingCharge: true, // <-- IMPORTANT
    },
  });

  if (!booking?.ride) notFound();
  const ride = booking.ride;

  if (ride.status !== RideStatus.COMPLETED) {
    return (
      <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
        <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
          <h1 className="text-xl font-semibold text-slate-900">Receipt</h1>
          <p className="text-sm text-slate-600">Receipt is only available once the ride is completed.</p>
          <Link className="text-sm text-indigo-600 hover:underline" href="/">
            Go back
          </Link>
        </div>
      </main>
    );
  }

  const distance = ride.distanceMiles ?? null;

  // ---------------- Money source of truth ----------------
  const oc = booking.outstandingCharge;

  const useOutstandingCharge = !!oc;

  let baseCents = 0;
  let discountCents = 0;
  let convenienceFeeCents = 0;
  let finalCents = 0;
  let paymentLabel: string | null = null;

  if (useOutstandingCharge) {
    baseCents = clampCents(oc!.fareCents);
    discountCents = 0;
    convenienceFeeCents = clampCents(oc!.convenienceFeeCents);
    finalCents = clampCents(oc!.totalCents);
    paymentLabel = "CASH";
  } else {
    const base =
      typeof (booking as any).baseAmountCents === "number" && (booking as any).baseAmountCents > 0
        ? (booking as any).baseAmountCents
        : ride.totalPriceCents ?? 0;

    const disc = typeof (booking as any).discountCents === "number" ? (booking as any).discountCents : 0;

    const final =
      typeof (booking as any).finalAmountCents === "number" && (booking as any).finalAmountCents > 0
        ? (booking as any).finalAmountCents
        : Math.max(0, base - disc);

    const netAfterDiscount = Math.max(0, base - disc);
    const fee = Math.max(0, final - netAfterDiscount);

    baseCents = clampCents(base);
    discountCents = clampCents(disc);
    finalCents = clampCents(final);
    convenienceFeeCents = clampCents(fee);
    paymentLabel = booking.paymentType ?? "n/a";
  }

  const showDiscount = discountCents > 0;
  const showFee = convenienceFeeCents > 0;

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
        <AutoPrint />

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Ride receipt</h1>
            <p className="text-xs text-slate-500">
              Booking ID: <span className="font-mono">{booking.id}</span>
            </p>
            {useOutstandingCharge ? (
              <p className="mt-1 text-[11px] text-slate-500">
                Unpaid cash ride: includes outstanding-charge convenience fee.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col items-end gap-2">
            <PrintButton />
            <EmailReceiptButton bookingId={booking.id} apiPath="/api/receipt/email" />
          </div>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">
              {ride.originCity} → {ride.destinationCity}
            </p>
            <p className="text-xs text-slate-500">Completed: {ride.tripCompletedAt?.toLocaleString() ?? "n/a"}</p>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Rider</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{booking.rider?.name || "Unknown"}</p>
              <p className="text-xs text-slate-500">{booking.rider?.email || ""}</p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Driver</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{ride.driver?.name || "Unknown"}</p>
              <p className="text-xs text-slate-500">{ride.driver?.email || ""}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Distance</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {distance != null ? `${distance.toFixed(2)} miles` : "n/a"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Passengers</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{ride.passengerCount}</p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Payment</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{paymentLabel ?? "n/a"}</p>
            </div>

            <div className="sm:text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">${moneyFromCents(finalCents)}</p>
              <p className="text-[11px] text-slate-500">Stored final: {finalCents} cents</p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <div className="flex items-center justify-between">
              <span>Base fare</span>
              <span className="font-semibold">${moneyFromCents(baseCents)}</span>
            </div>

            <div className="flex items-center justify-between">
              <span>Discount</span>
              <span className="font-semibold">{showDiscount ? `-$${moneyFromCents(discountCents)}` : "$0.00"}</span>
            </div>

            <div className="flex items-center justify-between">
              <span>Convenience fee</span>
              <span className="font-semibold">{showFee ? `$${moneyFromCents(convenienceFeeCents)}` : "$0.00"}</span>
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
              <span className="font-semibold">Total</span>
              <span className="font-semibold">${moneyFromCents(finalCents)}</span>
            </div>
          </div>
        </section>

        <p className="text-xs text-slate-500">Tip: this page is printable. Use “Print” to save as PDF.</p>
      </div>
    </main>
  );
}