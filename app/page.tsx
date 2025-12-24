// app/page.tsx
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { RiderRequestFormHome } from "@/components/RiderRequestFormHome";
import { MembershipSelector } from "@/components/MembershipSelector";
import { BookRideButton } from "@/components/BookRideButton";

export default async function Home() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role as
    | "RIDER"
    | "DRIVER"
    | undefined;

  // 🚩 NEW: only rides that are OPEN *and* have no ACCEPTED bookings
  const rides = await prisma.ride.findMany({
    where: {
      status: "OPEN",
      bookings: {
        none: {
          status: "ACCEPTED",
        },
      },
    },
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

  const showAvailableRidesSection =
    !session || role === "DRIVER";

  // …keep the rest of your JSX exactly as you have it now
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
              Share rides, save money,
              <br />
              travel together.
            </h1>
            <p className="mt-4 text-sm md:text-base text-slate-600">
              Riders pay a simple, transparent price. Drivers earn extra cash on
              trips they&apos;re already taking. Membership keeps the platform
              safe and sustainable for everyone.
            </p>

            {/* Membership “first month free” highlight */}
            <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Membership – first month free
              </p>
              <p className="mt-2 text-sm text-slate-800">
                Both{" "}
                <span className="font-semibold">driver</span> and{" "}
                <span className="font-semibold">rider</span> plans start with a{" "}
                <span className="font-semibold text-emerald-700">
                  30-day free membership
                </span>
                . No payment is required during setup.
              </p>
              <ul className="mt-2 space-y-1 text-xs text-slate-700 list-disc list-inside">
                <li>Drivers can post routes and receive booking requests.</li>
                <li>Riders can browse routes and request seats.</li>
                <li>Decide after the trial whether to continue on a paid plan.</li>
              </ul>
            </div>

            {/* CTA buttons + membership selector for guests */}
            {!session && <MembershipSelector />}

            {/* Pricing summary */}
            <div className="mt-6 rounded-2xl bg-white/90 border border-slate-100 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-800 mb-1">
                Pricing model
              </h2>
              <p className="text-sm text-slate-600">
                Riders pay a{" "}
                <span className="font-semibold text-slate-900">
                  $3.00 booking fee
                </span>{" "}
                plus{" "}
                <span className="font-semibold text-slate-900">
                  $2.00 per mile
                </span>{" "}
                for each trip.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Example: a 10 mile trip costs $3.00 + (10 × $2.00) = $23.00
                total for the ride.
              </p>
            </div>
          </div>

          {/* Illustration card */}
          <div className="md:justify-self-end">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-sky-500 to-emerald-400 p-[1px] shadow-lg">
              <div className="bg-slate-950/95 rounded-[22px] p-5 h-full">
                <p className="text-xs font-medium text-slate-300 mb-3">
                  Live example
                </p>
                <div className="space-y-3 text-xs text-slate-200">
                  <div className="flex items-center justify-between">
                    <span>San Francisco → San Jose</span>
                    <span className="font-semibold text-emerald-300">
                      $105.00
                    </span>
                  </div>
                  <p className="text-slate-400">
                    51 miles · Total ride price: $3.00 booking + $102.00
                    distance = $105.00.
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                    <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-2">
                      <p className="text-slate-400">Booking</p>
                      <p className="font-semibold text-slate-50">$3.00</p>
                    </div>
                    <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-2">
                      <p className="text-slate-400">Distance</p>
                      <p className="font-semibold text-slate-50">$102.00</p>
                    </div>
                    <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-2">
                      <p className="text-slate-400">Total</p>
                      <p className="font-semibold text-emerald-300">
                        $105.00
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 text-[11px] text-slate-500">
                  Drivers see their earnings after platform fees in their
                  dashboard.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Rider “Request a ride” – only for logged-in riders */}
        {session && (role === "RIDER") && (
          <RiderRequestFormHome />
        )}

        {/* Available rides – guests + drivers */}
        {showAvailableRidesSection && (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-slate-900">
              Available rides
            </h2>
            {rides.length === 0 ? (
              <p className="text-sm text-slate-600">
                No rides are available yet. Drivers will see their upcoming trips
                here once they start posting rides.
              </p>
            ) : (
              <ul className="space-y-3">
                {rides.map((ride) => {
                  const departure = new Date(ride.departureTime);
                  const price =
                    typeof ride.totalPriceCents === "number"
                      ? ride.totalPriceCents / 100
                      : 0;
                  const passengerCount =
                    (ride as any).passengerCount ?? 1;

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
                          {departure.toLocaleString()} • {ride.distanceMiles}{" "}
                          miles
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
                            ${price.toFixed(2)} total
                          </p>
                          <p className="text-xs text-slate-500">
                            Room for {passengerCount}{" "}
                            {passengerCount === 1 ? "passenger" : "passengers"}
                          </p>
                        </div>
                        <BookRideButton rideId={ride.id} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
