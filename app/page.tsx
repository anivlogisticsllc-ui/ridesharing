// app/page.tsx
import { prisma } from "@/lib/prisma";

export default async function Home() {
  const rides = await prisma.ride.findMany({
    orderBy: { departureTime: "asc" },
    take: 10,
    include: {
      driver: {
        select: {
          name: true,
          ratingAverage: true,
          ratingCount: true,
          isVerifiedDriver: true,
        },
      },
    },
  });

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-10 space-y-10">
        {/* Hero */}
        <section className="grid gap-8 md:grid-cols-2 items-center">
          <div>
            <p className="text-xs font-semibold tracking-wide text-indigo-600 uppercase">
              Community Ride Sharing
            </p>
            <h1 className="mt-2 text-3xl md:text-4xl font-semibold text-slate-900">
              Share rides, save money,<br />travel together.
            </h1>
            <p className="mt-4 text-sm md:text-base text-slate-600">
              Riders pay a simple, transparent price. Drivers earn extra cash on trips
              they&apos;re already taking. Membership keeps the platform safe and sustainable
              for everyone.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <button className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
                I&apos;m a Rider
              </button>
              <button className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
                I&apos;m a Driver
              </button>
            </div>

            {/* Pricing summary */}
            <div className="mt-6 rounded-2xl bg-white/90 border border-slate-100 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-800 mb-1">
                Pricing model
              </h2>
              <p className="text-sm text-slate-600">
                Riders pay a <span className="font-semibold text-slate-900">$3.00 booking fee</span>{" "}
                plus <span className="font-semibold text-slate-900">$2.00 per mile</span> for each trip.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Example: a 10 mile trip costs $3.00 + (10 × $2.00) = $23.00.
              </p>
            </div>
          </div>

          {/* Illustration card (unchanged from before) */}
          <div className="md:justify-self-end">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-sky-500 to-emerald-400 p-[1px] shadow-lg">
              <div className="bg-slate-950/95 rounded-[22px] p-5 h-full">
                <p className="text-xs font-medium text-slate-300 mb-3">
                  Live example
                </p>
                <div className="space-y-3 text-xs text-slate-200">
                  <div className="flex items-center justify-between">
                    <span>San Francisco → San Jose</span>
                    <span className="font-semibold text-emerald-300">$43.00</span>
                  </div>
                  <p className="text-slate-400">
                    20 miles · 1 rider · Includes $3.00 booking + $2.00 / mile.
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                    <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-2">
                      <p className="text-slate-400">Booking</p>
                      <p className="font-semibold text-slate-50">$3.00</p>
                    </div>
                    <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-2">
                      <p className="text-slate-400">Distance</p>
                      <p className="font-semibold text-slate-50">$40.00</p>
                    </div>
                    <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-2">
                      <p className="text-slate-400">Total</p>
                      <p className="font-semibold text-emerald-300">$43.00</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 text-[11px] text-slate-500">
                  Drivers see their earnings after platform fees in their dashboard.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Membership section (unchanged) */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-900">
            Membership plans
          </h2>
          <p className="text-sm text-slate-600 max-w-2xl">
            The app has two membership types. Riders pay a small monthly fee for access
            to the marketplace. Drivers pay for tools that help them fill seats and
            manage their trips.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Rider plan */}
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm flex flex-col justify-between">
              <div>
                <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                  Rider membership
                </span>
                <h3 className="mt-3 text-lg font-semibold text-slate-900">
                  Riders · $2.99 / month
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  For passengers who want to book seats in shared rides.
                </p>
                <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                  <li>• Browse and book rides</li>
                  <li>• See driver ratings &amp; verification status</li>
                  <li>• In-app chat with drivers after booking</li>
                  <li>• Transparent pricing: $3 + $2/mile</li>
                </ul>
              </div>
              <button className="mt-4 w-full rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100">
                Choose rider plan
              </button>
            </div>

            {/* Driver plan */}
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm flex flex-col justify-between">
              <div>
                <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                  Driver membership
                </span>
                <h3 className="mt-3 text-lg font-semibold text-slate-900">
                  Drivers · $9.99 / month
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  For drivers who want to offer rides and earn from empty seats.
                </p>
                <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                  <li>• Post rides with available seats</li>
                  <li>• See all booking requests in one place</li>
                  <li>• In-app messaging with passengers</li>
                  <li>• Earnings breakdown per ride</li>
                </ul>
              </div>
              <button className="mt-4 w-full rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
                Choose driver plan
              </button>
            </div>
          </div>
        </section>

        {/* Live rides list */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">
            Available rides
          </h2>
          {rides.length === 0 ? (
            <p className="text-sm text-slate-600">
              No rides are available yet. Drivers will see their upcoming trips here
              once they start posting rides.
            </p>
          ) : (
            <ul className="space-y-3">
              {rides.map((ride) => {
                const departure = new Date(ride.departureTime);
                const pricePerSeat = ride.pricePerSeatCents / 100;
                return (
                  <li
                    key={ride.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-1 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {ride.originCity} → {ride.destinationCity}
                      </p>
                      <p className="text-xs text-slate-500">
                        {departure.toLocaleString()} • {ride.distanceMiles} miles
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Driver:{" "}
                        <span className="font-medium text-slate-800">
                          {ride.driver?.name ?? "Unknown driver"}
                        </span>{" "}
                        {ride.driver?.isVerifiedDriver && (
                          <span className="ml-1 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            Verified
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="mt-2 flex items-center gap-3 md:mt-0">
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-900">
                          ${pricePerSeat.toFixed(2)} / seat
                        </p>
                        <p className="text-xs text-slate-500">
                          {ride.availableSeats} seats left
                        </p>
                      </div>
                      <button className="rounded-full bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700">
                        View &amp; book
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
