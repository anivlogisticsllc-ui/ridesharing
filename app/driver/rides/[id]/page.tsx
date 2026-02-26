// app/driver/rides/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BookingStatus, RideStatus, PaymentType } from "@prisma/client";

type Props = { params: Promise<{ id: string }> };

function money(cents: number | null | undefined) {
  const v = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  return (v / 100).toFixed(2);
}

function normalizeCents(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
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

  // ✅ ONLY fields that exist on your Booking model
  const booking = await prisma.booking.findFirst({
    where: {
      rideId: id,
      status: { in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED] },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      paymentType: true,
      cashDiscountBps: true,
      baseAmountCents: true,
      discountCents: true,
      finalAmountCents: true,
    },
  });

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

  // ---------- Money (truth source = booking.finalAmountCents if present) ----------
  const rideEstimateCents = normalizeCents((ride as any).totalPriceCents);

  const baseCents = normalizeCents(booking?.baseAmountCents ?? rideEstimateCents);
  const discountCents = normalizeCents(booking?.discountCents ?? 0);

  const finalCents =
    normalizeCents(booking?.finalAmountCents) ||
    Math.max(0, baseCents - discountCents) ||
    rideEstimateCents;

  // No fee column exists -> best effort derived fee
  const convenienceFeeCents = Math.max(0, finalCents - Math.max(0, baseCents - discountCents));

  const paymentLabel =
    booking?.paymentType === PaymentType.CARD
      ? "CARD"
      : booking?.paymentType === PaymentType.CASH
      ? "CASH"
      : "n/a";

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
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total fare</p>
              <p className="text-lg font-semibold text-slate-900">${money(finalCents)}</p>
              <p className="text-[11px] text-slate-500">Stored as {finalCents} cents</p>
            </div>
          </div>

          {/* Breakdown */}
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

          <div className="grid gap-4 text-sm text-slate-700 sm:grid-cols-3 pt-2">
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