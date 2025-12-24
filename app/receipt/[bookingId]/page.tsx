// app/receipt/[bookingId]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { RideStatus } from "@prisma/client";
import EmailReceiptButton from "./EmailReceiptButton";
import PrintButton from "./PrintButton";

type Props = {
  params: Promise<{ bookingId: string }>;
};

function moneyFromCents(cents: number | null | undefined) {
  const v = typeof cents === "number" ? cents : 0;
  return (v / 100).toFixed(2);
}

export default async function ReceiptPage({ params }: Props) {
  // ✅ important: unwrap params
  const { bookingId } = await params;
  if (!bookingId) notFound();

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      rider: true,
      ride: { include: { driver: true } },
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

  const distance = ride.distanceMiles ?? null;
  const fare = ride.totalPriceCents ?? null;

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Ride receipt</h1>
            <p className="text-xs text-slate-500">
              Booking ID: <span className="font-mono">{booking.id}</span>
            </p>
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
            <p className="text-xs text-slate-500">
              Completed: {ride.tripCompletedAt?.toLocaleString() ?? "n/a"}
            </p>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Rider</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {booking.rider?.name || "Unknown"}
              </p>
              <p className="text-xs text-slate-500">{booking.rider?.email || ""}</p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Driver</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {ride.driver?.name || "Unknown"}
              </p>
              <p className="text-xs text-slate-500">{ride.driver?.email || ""}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
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

            <div className="sm:text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                ${moneyFromCents(fare)}
              </p>
              <p className="text-[11px] text-slate-500">Stored as {fare ?? 0} cents</p>
            </div>
          </div>
        </section>

        <p className="text-xs text-slate-500">Tip: this page is printable. Use “Print” to save as PDF.</p>
      </div>
    </main>
  );
}
