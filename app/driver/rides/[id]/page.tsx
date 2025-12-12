// app/driver/rides/[id]/page.tsx

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

type RideDetailPageProps = {
  // In App Router + Turbopack, params is a Promise
  params: Promise<{ id: string }>;
};

export default async function RideDetailPage({ params }: RideDetailPageProps) {
  // Unwrap the params Promise
  const { id } = await params;

  const ride = await prisma.ride.findUnique({
    where: { id },
    include: {
      rider: true,
      driver: true,
    },
  });

  if (!ride) {
    notFound();
  }

  const startedAt = ride.tripStartedAt ?? ride.departureTime;
  const completedAt = ride.tripCompletedAt ?? ride.updatedAt;

  const durationMs =
    ride.tripStartedAt && ride.tripCompletedAt
      ? ride.tripCompletedAt.getTime() - ride.tripStartedAt.getTime()
      : 0;

  const durationMinutes = durationMs > 0 ? durationMs / 1000 / 60 : 0;

  const formatDuration = (minutes: number) => {
    if (minutes <= 0) return "n/a";
    const totalMinutes = Math.round(minutes);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours === 0) return `${mins} min`;
    return `${hours}h ${mins}m`;
  };

  const distanceMiles = ride.distanceMiles ?? 0;
  const totalPriceCents = ride.totalPriceCents ?? 0;
  const totalPriceDollars = (totalPriceCents / 100).toFixed(2);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        <Link
          href="/driver/dashboard"
          className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900"
        >
          <span className="mr-1">←</span>
          Back to dashboard
        </Link>

        {/* Header */}
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">
            Ride details
          </h1>
          <p className="text-sm text-slate-600">
            {ride.originCity} → {ride.destinationCity}
          </p>
          <p className="text-xs text-slate-500">
            Ride ID: <span className="font-mono">{ride.id}</span>
          </p>
        </header>

        {/* Trip summary */}
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Trip status
              </p>
              <p className="text-sm font-semibold text-slate-900">
                {ride.status}
              </p>
            </div>

            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Total fare
              </p>
              <p className="text-lg font-semibold text-slate-900">
                ${totalPriceDollars}
              </p>
              <p className="text-[11px] text-slate-500">
                Stored as {totalPriceCents} cents
              </p>
            </div>
          </div>

          <div className="grid gap-4 text-sm text-slate-700 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Distance
              </p>
              <p className="mt-1 font-semibold">
                {distanceMiles > 0 ? `${distanceMiles.toFixed(2)} miles` : "n/a"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Duration
              </p>
              <p className="mt-1 font-semibold">
                {formatDuration(durationMinutes)}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Passenger count
              </p>
              <p className="mt-1 font-semibold">{ride.passengerCount}</p>
            </div>
          </div>
        </section>

        {/* Timing */}
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-sm text-slate-700">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Timing
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-slate-500">Scheduled departure</p>
              <p className="mt-1 font-medium">
                {ride.departureTime.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Trip started</p>
              <p className="mt-1 font-medium">
                {startedAt ? startedAt.toLocaleString() : "n/a"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Trip completed</p>
              <p className="mt-1 font-medium">
                {completedAt ? completedAt.toLocaleString() : "n/a"}
              </p>
            </div>
          </div>
        </section>

        {/* Route & vehicle */}
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-sm text-slate-700">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Route & vehicle
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-slate-500">Pickup</p>
              <p className="mt-1 font-medium">{ride.originCity}</p>
              <p className="text-[11px] text-slate-500">
                ({ride.originLat.toFixed(4)}, {ride.originLng.toFixed(4)})
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Dropoff</p>
              <p className="mt-1 font-medium">{ride.destinationCity}</p>
              <p className="text-[11px] text-slate-500">
                ({ride.destinationLat.toFixed(4)},{" "}
                {ride.destinationLng.toFixed(4)})
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-slate-500">Vehicle</p>
              <p className="mt-1 font-medium">
                {ride.vehicleMake && ride.vehicleModel
                  ? `${ride.vehicleMake} ${ride.vehicleModel}`
                  : "Not specified"}
              </p>
              <p className="text-[11px] text-slate-500">
                {ride.vehicleColor || ""}{" "}
                {ride.licensePlate ? `• Plate: ${ride.licensePlate}` : ""}
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500">Driver</p>
              <p className="mt-1 font-medium">
                {ride.driver?.name || "You"}
              </p>
              <p className="text-[11px] text-slate-500">
                Rider: {ride.rider?.name || "Unknown"}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-500">
            Map / path visualization can go here later. For now this page shows
            stored distance, price, and timing from the database.
          </div>
        </section>
      </div>
    </main>
  );
}
