"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { TripMeter } from "@/components/driver/TripMeter";

type ServiceCity = {
  id: string;
  cityName: string;
  cityLat: number;
  cityLng: number;
};

type DriverProfile = {
  id: string;
  baseCity: string | null;
  baseLat: number | null;
  baseLng: number | null;
  serviceCities: ServiceCity[];
};

type DriverProfileResponse =
  | { ok: true; profile: DriverProfile | null }
  | { ok: false; error: string };

type MeResponse = {
  membershipActive: boolean;
  membershipPlan: string | null;
  trialEndsAt: string | null; // ISO string from API
};

// Keep this in sync with your RideStatus enum
type RideStatusUI =
  | "OPEN"
  | "ACCEPTED"
  | "IN_ROUTE"
  | "COMPLETED"
  | "CANCELLED";

type DriverRide = {
  // Primary React key; usually the ride row id
  id: string;

  // Canonical ride id for links / APIs (can be same as id)
  rideId: string;

  originCity: string;
  destinationCity: string;
  departureTime: string; // ISO
  status: RideStatusUI;
  riderName: string | null;
  riderPublicId: string | null;

  // Chat
  conversationId: string | null;

  // Timing + receipt
  tripStartedAt: string | null;
  tripCompletedAt: string | null;
  distanceMiles?: number | null;
  totalPriceCents?: number | null;
};

type PortalRidesResponse =
  | { ok: true; accepted: DriverRide[]; completed: DriverRide[] }
  | { ok: false; error: string };

/* ---------- Helpers ---------- */

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ---------- Page ---------- */

export default function DriverPortalPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [serviceCities, setServiceCities] = useState<ServiceCity[]>([]);
  const [serviceLoading, setServiceLoading] = useState(true);

  const [cityName, setCityName] = useState("");
  const [savingCity, setSavingCity] = useState(false);
  const [cityError, setCityError] = useState<string | null>(null);

  const [membership, setMembership] = useState<MeResponse | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(true);

  const [acceptedRides, setAcceptedRides] = useState<DriverRide[]>([]);
  const [completedRides, setCompletedRides] = useState<DriverRide[]>([]);
  const [ridesLoading, setRidesLoading] = useState(true);
  const [ridesError, setRidesError] = useState<string | null>(null);

  // Chat overlay state
  const [activeConversationId, setActiveConversationId] =
    useState<string | null>(null);

  /* ---------- Session / access control + initial loads ---------- */

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace("/auth/login?callbackUrl=/driver/portal");
      return;
    }

    const role = (session.user as any).role as
      | "RIDER"
      | "DRIVER"
      | "BOTH"
      | undefined;

    if (role !== "DRIVER" && role !== "BOTH") {
      router.replace("/");
      return;
    }

    async function loadProfile() {
      try {
        const res = await fetch("/api/driver/service-cities");
        const data: DriverProfileResponse = await res.json();
        if (res.ok && data.ok && data.profile) {
          setServiceCities(data.profile.serviceCities);
        }
      } catch (err) {
        console.error("Error loading driver profile:", err);
      } finally {
        setServiceLoading(false);
      }
    }

    async function loadMembership() {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) return;
        const data = (await res.json()) as MeResponse | any;

        setMembership({
          membershipActive: !!data.membershipActive,
          membershipPlan: data.membershipPlan ?? null,
          trialEndsAt: data.trialEndsAt ?? null,
        });
      } catch (err) {
        console.error("Error loading membership:", err);
      } finally {
        setMembershipLoading(false);
      }
    }

    async function loadRides() {
      try {
        const res = await fetch("/api/driver/portal-rides");
        const data: PortalRidesResponse = await res.json();

        if (!res.ok || !("ok" in data) || !data.ok) {
          throw new Error((data as any)?.error || "Failed to load rides.");
        }

        // Normalize: ensure we always have rideId + trip timestamps + conversationId
        const normalize = (r: any): DriverRide => ({
          ...r,
          rideId: r.rideId ?? r.id,
          tripStartedAt: r.tripStartedAt ?? null,
          tripCompletedAt: r.tripCompletedAt ?? null,
          conversationId: r.conversationId ?? null,
        });

        setAcceptedRides(data.accepted.map(normalize));
        setCompletedRides(data.completed.map(normalize));
        setRidesError(null);
      } catch (err: any) {
        console.error("Error loading driver rides:", err);
        setRidesError(err.message || "Could not load rides.");
      } finally {
        setRidesLoading(false);
      }
    }

    loadProfile();
    loadMembership();
    loadRides();
  }, [session, status, router]);

  /* ---------- Service cities actions ---------- */

  async function handleAddCity(e: FormEvent) {
    e.preventDefault();
    if (!cityName.trim()) return;

    setSavingCity(true);
    setCityError(null);

    try {
      const res = await fetch("/api/driver/service-cities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cityName: cityName.trim() }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to add city");
      }

      setServiceCities((prev) => [...prev, data.city]);
      setCityName("");
    } catch (err: any) {
      console.error("Error adding service city:", err);
      setCityError(err.message || "Something went wrong");
    } finally {
      setSavingCity(false);
    }
  }

  async function handleRemoveCity(id: string) {
    try {
      const res = await fetch("/api/driver/service-cities", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to remove city");
      }

      setServiceCities((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error("Error removing service city:", err);
    }
  }

  /* ---------- Trip meter & ride actions ---------- */

  async function handleStartRide(rideId: string) {
    try {
      const res = await fetch("/api/driver/start-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rideId }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to start ride.");
      }

      const nowIso = new Date().toISOString();
      setAcceptedRides((prev) =>
        prev.map((r) =>
          r.rideId === rideId
            ? {
                ...r,
                status: "IN_ROUTE",
                tripStartedAt: r.tripStartedAt ?? nowIso,
              }
            : r
        )
      );
    } catch (err) {
      console.error("Error starting ride:", err);
    }
  }

  async function handleCompleteRide(
    rideId: string,
    summary?: {
      elapsedSeconds: number;
      distanceMiles: number;
      fareCents: number;
    }
  ) {
    try {
      const res = await fetch("/api/driver/complete-ride", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rideId,
          elapsedSeconds: summary?.elapsedSeconds ?? null,
          distanceMiles: summary?.distanceMiles ?? null,
          fareCents: summary?.fareCents ?? null,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to complete ride.");
      }

      const nowIso = new Date().toISOString();

      setAcceptedRides((prevAccepted) => {
        const ride = prevAccepted.find((r) => r.rideId === rideId);
        if (!ride) return prevAccepted;

        const completedRide: DriverRide = {
          ...ride,
          status: "COMPLETED",
          tripCompletedAt: ride.tripCompletedAt ?? nowIso,
          distanceMiles:
            summary?.distanceMiles ?? ride.distanceMiles ?? null,
          totalPriceCents:
            summary?.fareCents ?? ride.totalPriceCents ?? null,
        };

        setCompletedRides((prevCompleted) => {
          const withoutThis = prevCompleted.filter(
            (r) => r.rideId !== rideId
          );
          return [completedRide, ...withoutThis];
        });

        return prevAccepted.filter((r) => r.rideId !== rideId);
      });
    } catch (err) {
      console.error("Error completing ride:", err);
    }
  }

  /* ---------- Membership messaging ---------- */

  const trialMessage = useMemo(() => {
    if (!membership?.trialEndsAt) return null;
    const trialEnd = safeDate(membership.trialEndsAt);
    if (!trialEnd) return null;

    if (trialEnd.getTime() > Date.now()) {
      return `Free trial active until ${trialEnd.toLocaleDateString()}.`;
    }

    return `Your free trial ended on ${trialEnd.toLocaleDateString()}. Paid plans will be added later.`;
  }, [membership]);

  /* ---------- Derived ride lists & sorting ---------- */

  const today = useMemo(() => new Date(), []);

  const sortedAcceptedRides = useMemo(() => {
    const copy = [...acceptedRides];

    // IN_ROUTE first, then by departure time asc
    copy.sort((a, b) => {
      const aInRoute = a.status === "IN_ROUTE";
      const bInRoute = b.status === "IN_ROUTE";

      if (aInRoute && !bInRoute) return -1;
      if (!aInRoute && bInRoute) return 1;

      const da = safeDate(a.departureTime)?.getTime() ?? 0;
      const db = safeDate(b.departureTime)?.getTime() ?? 0;
      return da - db;
    });

    return copy;
  }, [acceptedRides]);

  const dedupedTodayCompletedRides = useMemo(() => {
    const todays = completedRides.filter((ride) => {
      const completedDate =
        safeDate(ride.tripCompletedAt) || safeDate(ride.departureTime);
      if (!completedDate) return false;
      return isSameDay(completedDate, today);
    });

    // Dedupe by rideId
    const map = new Map<string, DriverRide>();
    for (const r of todays) {
      map.set(r.rideId, r);
    }

    const unique = Array.from(map.values());

    // Sort by completion time desc, fallback to departure desc
    unique.sort((a, b) => {
      const da =
        safeDate(a.tripCompletedAt || a.departureTime)?.getTime() ?? 0;
      const db =
        safeDate(b.tripCompletedAt || b.departureTime)?.getTime() ?? 0;
      return db - da;
    });

    return unique;
  }, [completedRides, today]);

  /* ---------- Loading guard ---------- */

  if (status === "loading" || !session) {
    return <p className="py-10 text-center text-slate-600">Loading…</p>;
  }

  /* ---------- Render ---------- */

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
        {/* Membership / trial banner */}
        <section>
          {membershipLoading ? (
            <p className="text-xs text-slate-500">
              Checking membership…
            </p>
          ) : membership ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-xs ${
                membership.membershipActive
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              {membership.membershipActive ? (
                <>
                  <p className="font-semibold">
                    Driver membership is active (first month free).
                  </p>
                  {trialMessage && (
                    <p className="mt-1 text-[11px] text-emerald-900/90">
                      {trialMessage}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="font-semibold">
                    Driver membership is not active yet.
                  </p>
                  <p className="mt-1 text-[11px] text-amber-900/90">
                    You can still manage your service area, but once paid
                    plans go live you&apos;ll need an active membership to
                    accept rides.
                  </p>
                </>
              )}
            </div>
          ) : null}
        </section>

        {/* Accepted rides */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">
            My accepted rides
          </h2>

          {ridesLoading ? (
            <p className="text-sm text-slate-500">Loading rides…</p>
          ) : ridesError ? (
            <p className="text-sm text-rose-600">{ridesError}</p>
          ) : sortedAcceptedRides.length === 0 ? (
            <p className="text-sm text-slate-500">
              You haven&apos;t accepted any rides yet. Book one from the
              home page.
            </p>
          ) : (
            <ul className="space-y-3">
              {sortedAcceptedRides.map((ride) => {
                const dt =
                  safeDate(ride.departureTime) ??
                  new Date(ride.departureTime);

                const meterStatus: "OPEN" | "FULL" | "IN_ROUTE" | "COMPLETED" =
                  ride.status === "IN_ROUTE"
                    ? "IN_ROUTE"
                    : ride.status === "COMPLETED"
                    ? "COMPLETED"
                    : "OPEN";

                const isInRoute = ride.status === "IN_ROUTE";

                const canChat =
                  !!ride.conversationId &&
                  ride.conversationId.trim().length > 0;

                // Concurrency guard: disable chat while IN_ROUTE
                const chatDisabled = !canChat || isInRoute;

                return (
                  <li
                    key={ride.id}
                    className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {ride.originCity} → {ride.destinationCity}
                      </p>
                      <p className="text-xs text-slate-500">
                        {dt.toLocaleString()} • Status: {ride.status}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Rider:{" "}
                        <span className="font-medium text-slate-800">
                          {ride.riderPublicId ||
                            ride.riderName ||
                            "Unknown rider"}
                        </span>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {/* Disable navigation while trip is in route */}
                      <button
                        type="button"
                        onClick={() =>
                          !isInRoute &&
                          router.push(`/driver/rides/${ride.rideId}`)
                        }
                        disabled={isInRoute}
                        className={`rounded-full px-4 py-2 text-xs font-medium text-white ${
                          isInRoute
                            ? "cursor-not-allowed bg-slate-400 opacity-60"
                            : "bg-slate-900 hover:bg-slate-800"
                        }`}
                      >
                        View trip details
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          !chatDisabled &&
                          setActiveConversationId(
                            ride.conversationId as string
                          )
                        }
                        disabled={chatDisabled}
                        className={`rounded-full px-4 py-2 text-xs font-medium text-white ${
                          chatDisabled
                            ? "cursor-not-allowed bg-slate-300 opacity-60"
                            : "bg-indigo-600 hover:bg-indigo-700"
                        }`}
                      >
                        View chat
                      </button>
                    </div>

                    <TripMeter
                      status={meterStatus}
                      tripStartedAt={ride.tripStartedAt}
                      tripCompletedAt={ride.tripCompletedAt}
                      onStartRide={() => handleStartRide(ride.rideId)}
                      onCompleteRide={(summary) =>
                        handleCompleteRide(ride.rideId, summary)
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Completed rides today */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">
            Rides completed today
          </h2>

          {ridesLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : dedupedTodayCompletedRides.length === 0 ? (
            <p className="text-sm text-slate-500">
              No rides completed today.
            </p>
          ) : (
            <ul className="space-y-3">
              {dedupedTodayCompletedRides.map((ride) => {
                const dt =
                  safeDate(ride.tripCompletedAt) ??
                  safeDate(ride.departureTime) ??
                  new Date(ride.departureTime);

                const canChat =
                  !!ride.conversationId &&
                  ride.conversationId.trim().length > 0;

                return (
                  <li
                    key={ride.id}
                    className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {ride.originCity} → {ride.destinationCity}
                      </p>
                      <p className="text-xs text-slate-500">
                        {dt.toLocaleString()} • Status: {ride.status}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Rider:{" "}
                        <span className="font-medium text-slate-800">
                          {ride.riderPublicId ||
                            ride.riderName ||
                            "Unknown rider"}
                        </span>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          router.push(`/driver/rides/${ride.rideId}`)
                        }
                        className="rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
                      >
                        View trip details
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          canChat &&
                          setActiveConversationId(
                            ride.conversationId as string
                          )
                        }
                        disabled={!canChat}
                        className={`rounded-full border px-4 py-2 text-xs font-medium ${
                          canChat
                            ? "border-slate-300 text-slate-800 hover:bg-slate-50"
                            : "cursor-not-allowed border-slate-200 text-slate-400"
                        }`}
                      >
                        View chat
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Service area header */}
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">
            Driver service area
          </h1>
          <p className="text-sm text-slate-600">
            Add the cities where you regularly work. For now, keep your area
            local (within about 10 miles). Later we&apos;ll automatically
            enforce distance limits and use these cities to match you with
            rider requests.
          </p>
        </header>

        {/* Service cities */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-800">
            My service cities
          </h2>

          {serviceLoading ? (
            <p className="text-sm text-slate-500">
              Loading service area…
            </p>
          ) : serviceCities.length === 0 ? (
            <p className="text-sm text-slate-500">
              You haven&apos;t added any cities yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {serviceCities.map((city) => (
                <span
                  key={city.id}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-800 shadow-sm"
                >
                  {city.cityName}
                  <button
                    type="button"
                    className="text-slate-400 hover:text-rose-500"
                    onClick={() => handleRemoveCity(city.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Add city form */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-800">
            Add a city
          </h2>
          <form
            onSubmit={handleAddCity}
            className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center"
          >
            <div className="flex-1">
              <input
                type="text"
                value={cityName}
                onChange={(e) => setCityName(e.target.value)}
                placeholder="e.g. San Francisco, Daly City"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={savingCity || !cityName.trim()}
              className="rounded-full bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {savingCity ? "Adding…" : "Add city"}
            </button>
          </form>
          {cityError && (
            <p className="mt-2 text-xs text-rose-600">{cityError}</p>
          )}
        </section>
      </div>

      {activeConversationId && (
        <ChatOverlay
          conversationId={activeConversationId}
          onClose={() => setActiveConversationId(null)}
        />
      )}
    </main>
  );
}

/* ---------- Chat overlay (driver side) ---------- */

function ChatOverlay(props: { conversationId: string; onClose: () => void }) {
  const { conversationId, onClose } = props;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60">
      <div className="flex h-[min(650px,100%)] w-[min(900px,100%)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-sm">
          <span className="font-semibold">Chat with rider</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="text-lg leading-none text-slate-500 hover:text-slate-800"
          >
            ×
          </button>
        </div>
        <iframe
          src={`/chat/${conversationId}`}
          title="Driver chat"
          className="h-full w-full border-0"
        />
      </div>
    </div>
  );
}
