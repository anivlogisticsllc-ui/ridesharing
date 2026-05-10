// app/receipt/[bookingId]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PaymentType, RidePaymentStatus, RideStatus } from "@prisma/client";
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

  const latestRidePayment = await prisma.ridePayment.findFirst({
    where: {
      rideId: ride.id,
      riderId: booking.riderId ?? undefined,
      paymentType: PaymentType.CARD,
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
      id: true,
      baseAmountCents: true,
      discountCents: true,
      finalAmountCents: true,
      tipAmountCents: true,
      tipPercent: true,
      tipStatus: true,
      capturedAt: true,
    },
  });

  const fallbackCharged = Boolean(booking.cashNotPaidAt && booking.fallbackCardChargedAt);
  const originallyCash = booking.originalPaymentType === PaymentType.CASH;

  const baseCents =
    clampCents(latestRidePayment?.baseAmountCents) ||
    clampCents(booking.baseAmountCents) ||
    clampCents(ride.totalPriceCents);

  const discountCents = fallbackCharged
    ? 0
    : clampCents(latestRidePayment?.discountCents) || clampCents(booking.discountCents);

  const tipCents = clampCents(latestRidePayment?.tipAmountCents);

  const totalCents =
    clampCents(latestRidePayment?.finalAmountCents) ||
    clampCents(booking.finalAmountCents) ||
    Math.max(0, baseCents - discountCents + tipCents);

  const convenienceFeeCents = Math.max(
    0,
    totalCents - Math.max(0, baseCents - discountCents) - tipCents
  );

  let displayedPaymentLabel: string | null = null;

  if (fallbackCharged) {
    displayedPaymentLabel = "CARD (fallback after unpaid CASH)";
  } else if (originallyCash && booking.paymentType === PaymentType.CASH) {
    displayedPaymentLabel = "CASH";
  } else {
    displayedPaymentLabel = paymentLabel(booking.paymentType);
  }

  const completedAt =
    ride.tripCompletedAt?.toLocaleString() ?? booking.updatedAt.toLocaleString();

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <AutoPrint />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Ride receipt</h1>
            <p className="text-sm text-slate-500">Booking ID: {booking.id}</p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <PrintButton />
            <EmailReceiptButton bookingId={booking.id} />
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-5">
            <div className="text-xl font-semibold text-slate-900">
              {ride.originCity} → {ride.destinationCity}
            </div>
            <div className="mt-2 text-sm text-slate-500">
              Completed: {completedAt}
            </div>
          </div>

          <div className="grid gap-6 px-5 py-5 md:grid-cols-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Rider</div>
              <div className="mt-2 font-semibold text-slate-900">
                {booking.riderName ?? booking.rider?.name ?? "—"}
              </div>
              <div className="text-sm text-slate-500">
                {booking.riderEmail ?? booking.rider?.email ?? "—"}
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Driver</div>
              <div className="mt-2 font-semibold text-slate-900">
                {ride.driver?.name ?? "—"}
              </div>
              <div className="text-sm text-slate-500">{ride.driver?.email ?? "—"}</div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Distance</div>
              <div className="mt-2 font-semibold text-slate-900">
                {typeof ride.distanceMiles === "number"
                  ? `${ride.distanceMiles.toFixed(2)} miles`
                  : "—"}
              </div>
              <div className="mt-4 text-xs uppercase tracking-wide text-slate-500">Passengers</div>
              <div className="mt-2 font-semibold text-slate-900">
                {ride.passengerCount ?? 1}
              </div>
            </div>

            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-slate-500">Payment</div>
              <div className="mt-2 font-semibold text-slate-900">
                {displayedPaymentLabel ?? "—"}
              </div>

              <div className="mt-4 text-xs uppercase tracking-wide text-slate-500">Total charged</div>
              <div className="mt-2 text-3xl font-bold text-slate-900">
                ${moneyFromCents(totalCents)}
              </div>
              <div className="text-sm text-slate-500">Stored final: {totalCents} cents</div>
            </div>
          </div>

          <div className="px-5 pb-5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between py-1 text-slate-700">
                <span>Base fare</span>
                <span className="font-medium">${moneyFromCents(baseCents)}</span>
              </div>

              <div className="flex items-center justify-between py-1 text-slate-700">
                <span>Tip</span>
                <span className="font-medium">${moneyFromCents(tipCents)}</span>
              </div>

              <div className="flex items-center justify-between py-1 text-slate-700">
                <span>Discount</span>
                <span className="font-medium">-${moneyFromCents(discountCents)}</span>
              </div>

              <div className="flex items-center justify-between py-1 text-slate-700">
                <span>Convenience fee</span>
                <span className="font-medium">${moneyFromCents(convenienceFeeCents)}</span>
              </div>

              <div className="mt-2 border-t border-slate-200 pt-3">
                <div className="flex items-center justify-between text-lg font-semibold text-slate-900">
                  <span>Total charged</span>
                  <span>${moneyFromCents(totalCents)}</span>
                </div>
              </div>
            </div>

            {latestRidePayment?.tipStatus && (
              <div className="mt-4 text-sm text-slate-500">
                Tip status: {latestRidePayment.tipStatus}
                {typeof latestRidePayment.tipPercent === "number"
                  ? ` • ${latestRidePayment.tipPercent}%`
                  : ""}
              </div>
            )}

            <div className="mt-8 text-sm text-slate-500">
              Tip: this page is printable. Use “Print” to save as PDF.
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}