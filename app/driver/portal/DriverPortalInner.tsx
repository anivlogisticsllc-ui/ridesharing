// app/driver/portal/DriverPortalInner.tsx
"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { TripMeter } from "@/components/driver/TripMeter";
import { computeMembershipState, formatDate, type MeMembership } from "@/lib/membership";
import { daysUntil } from "@/lib/dateUtils";

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

type RideStatusUI = "OPEN" | "ACCEPTED" | "IN_ROUTE" | "COMPLETED" | "CANCELLED";

type DriverRide = {
  id: string;
  rideId: string;
  bookingId: string | null;
  originCity: string;
  destinationCity: string;
  departureTime: string; // ISO
  status: RideStatusUI;

  riderName: string | null;
  riderPublicId: string | null;

  conversationId: string | null;
  unreadCount?: number;

  tripStartedAt: string | null;
  tripCompletedAt: string | null;
  distanceMiles?: number | null;
  totalPriceCents?: number | null;
};

type PortalRidesResponse =
  | { ok: true; accepted: DriverRide[]; completed: DriverRide[] }
  | { ok: false; error: string };

type ActiveChatContext = {
  conversationId: string;
  prefill: string | null;
  autoClose: boolean;
  readOnly?: boolean;
};

type MembershipApiResponse =
  | {
      ok: true;
      user: {
        id: string;
        name: string | null;
        email: string;
        role: "RIDER" | "DRIVER";
        onboardingCompleted: boolean;
      };
      membership: MeMembership & { status?: string | null };
    }
  | { ok: false; error: string };

type SessionUser = {
  role?: "RIDER" | "DRIVER" | "BOTH" | "ADMIN";
  name?: string | null;
} & Record<string, unknown>;

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

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function extractProfilePayload(raw: unknown): DriverProfile | null {
  if (!isObject(raw)) return null;

  // Accept either { ok:true, profile } or legacy-ish shapes
  const ok = raw.ok === true;
  const profileCandidate =
    (ok && raw.profile) ? raw.profile :
    raw.driverProfile ? raw.driverProfile :
    raw.profile ? raw.profile :
    null;

  if (!isObject(profileCandidate)) return null;
  if (!Array.isArray(profileCandidate.serviceCities)) return null;

  return profileCandidate as unknown as DriverProfile;
}

async function readApiError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return `Request failed (HTTP ${res.status}).`;

  try {
    const json: unknown = JSON.parse(text);
    if (isObject(json)) {
      const maybeError = json.error ?? json.message;
      if (typeof maybeError === "string" && maybeError.trim()) return maybeError;
    }
    return `Request failed (HTTP ${res.status}).`;
  } catch {
    return text.slice(0, 300) || `Request failed (HTTP ${res.status}).`;
  }
}

async function markConversationRead(conversationId: string) {
  await fetch("/api/chat/mark-read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId }),
  }).catch(() => null);
}

function normalizeRide(raw: DriverRide): DriverRide {
  const canonicalRideId = String(raw.rideId ?? raw.id ?? "");
  return {
    ...raw,
    id: String(raw.id ?? canonicalRideId),
    rideId: canonicalRideId,
    bookingId: raw.bookingId ?? null,
    tripStartedAt: raw.tripStartedAt ?? null,
    tripCompletedAt: raw.tripCompletedAt ?? null,
    conversationId: raw.conversationId ?? null,
    unreadCount: typeof raw.unreadCount === "number" ? raw.unreadCount : 0,
  };
}

/* ---------- Component ---------- */

export default function DriverPortalInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [serviceCities, setServiceCities] = useState<ServiceCity[]>([]);
  const [serviceLoading, setServiceLoading] = useState(true);

  const [cityName, setCityName] = useState("");
  const [savingCity, setSavingCity] = useState(false);
  const [cityError, setCityError] = useState<string | null>(null);

  const [membership, setMembership] = useState<MeMembership | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(true);

  const [acceptedRides, setAcceptedRides] = useState<DriverRide[]>([]);
  const [completedRides, setCompletedRides] = useState<DriverRide[]>([]);
  const [ridesLoading, setRidesLoading] = useState(true);
  const [ridesError, setRidesError] = useState<string | null>(null);

  const [activeChat, setActiveChat] = useState<ActiveChatContext | null>(null);

  const [rideActionError, setRideActionError] = useState<string | null>(null);
  const [busyRideId, setBusyRideId] = useState<string | null>(null);

  const sessionUser = (session?.user ?? null) as SessionUser | null;
  const sessionRole = sessionUser?.role;

  /* ---------- Session / access control + initial loads ---------- */

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace("/auth/login?callbackUrl=/driver/portal");
      return;
    }

    if (sessionRole !== "DRIVER" && sessionRole !== "BOTH") {
      router.replace("/");
      return;
    }

    async function loadProfile() {
      try {
        const res = await fetch("/api/driver/service-cities", { cache: "no-store" });
        const raw = (await res.json().catch(() => null)) as unknown;

        const profile = extractProfilePayload(raw);
        if (res.ok && profile?.serviceCities) setServiceCities(profile.serviceCities);
      } catch (err) {
        console.error("Error loading driver profile:", err);
      } finally {
        setServiceLoading(false);
      }
    }

    async function loadMembership() {
      try {
        const res = await fetch("/api/billing/membership", { cache: "no-store" });

        if (res.status === 401) {
          router.replace("/auth/login?callbackUrl=/driver/portal");
          return;
        }

        const json = (await res.json().catch(() => null)) as MembershipApiResponse | null;

        if (!res.ok || !json?.ok) {
          // keep silent; membership is optional here
          setMembership(null);
          return;
        }

        setMembership(json.membership);
      } catch (err) {
        console.error("Error loading membership:", err);
        setMembership(null);
      } finally {
        setMembershipLoading(false);
      }
    }

    async function loadRides() {
      try {
        const res = await fetch("/api/driver/portal-rides", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as PortalRidesResponse | null;

        if (!data || !res.ok || !data.ok) {
          const msg = data && "error" in data ? data.error : "Failed to load rides.";
          throw new Error(msg);
        }

        setAcceptedRides(data.accepted.map(normalizeRide));
        setCompletedRides(data.completed.map(normalizeRide));
        setRidesError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not load rides.";
        console.error("Error loading driver rides:", err);
        setRidesError(message);
      } finally {
        setRidesLoading(false);
      }
    }

    loadProfile();
    loadMembership();
    loadRides();
  }, [session, status, router, sessionRole]);

  /* ---------- Auto-open chat when arriving with query params ---------- */

  useEffect(() => {
    if (activeChat) return;

    const sp = searchParams ?? new URLSearchParams();
    const convId = sp.get("conversationId");
    if (!convId) return;

    const autoOpenChat = sp.get("autoOpenChat") === "1";
    const prefillParam = sp.get("prefill");

    if (prefillParam !== null) {
      const autoClose = sp.get("autoClose") === "1";
      setActiveChat({
        conversationId: convId,
        prefill: prefillParam.trim().length > 0 ? prefillParam : null,
        autoClose,
        readOnly: false,
      });
      return;
    }

    if (!autoOpenChat) return;
    if (ridesLoading) return;

    const ride = acceptedRides.find((r) => r.conversationId === convId);

    if (!ride) {
      setActiveChat({ conversationId: convId, prefill: null, autoClose: true, readOnly: false });
      router.replace("/driver/portal");
      return;
    }

    const riderLabel = ride.riderPublicId || ride.riderName || "there";
    const driverLabel = sessionUser?.name || "your driver";

    const riderFirst = String(riderLabel).trim().split(" ")[0];
    const driverFirst = String(driverLabel).trim().split(" ")[0];

    setActiveChat({
      conversationId: convId,
      prefill: `Hi ${riderFirst}, this is ${driverFirst}. I will be at your location in 10 minutes.`,
      autoClose: true,
      readOnly: false,
    });

    router.replace("/driver/portal");
  }, [searchParams, activeChat, ridesLoading, acceptedRides, router, sessionUser]);

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

      if (!res.ok) throw new Error(await readApiError(res));

      const data = (await res.json().catch(() => null)) as unknown;
      if (!isObject(data) || data.ok !== true || !isObject(data.city)) {
        const errMsg = isObject(data) && typeof data.error === "string" ? data.error : "Failed to add city";
        throw new Error(errMsg);
      }

      setServiceCities((prev) => [...prev, data.city as unknown as ServiceCity]);
      setCityName("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      console.error("Error adding service city:", err);
      setCityError(message);
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

      if (!res.ok) throw new Error(await readApiError(res));

      const data = (await res.json().catch(() => null)) as unknown;
      if (!isObject(data) || data.ok !== true) {
        const errMsg = isObject(data) && typeof data.error === "string" ? data.error : "Failed to remove city";
        throw new Error(errMsg);
      }

      setServiceCities((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error("Error removing service city:", err);
    }
  }

  /* ---------- Trip meter & ride actions ---------- */

  async function handleStartRide(rideId: string) {
    if (busyRideId) return;

    setRideActionError(null);
    setBusyRideId(rideId);

    try {
      const res = await fetch("/api/driver/start-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rideId }),
      });

      if (!res.ok) throw new Error(await readApiError(res));

      const data = (await res.json().catch(() => null)) as unknown;
      if (!isObject(data) || data.ok !== true) {
        const errMsg = isObject(data) && typeof data.error === "string" ? data.error : "Failed to start ride.";
        throw new Error(errMsg);
      }

      const nowIso = new Date().toISOString();
      setAcceptedRides((prev) =>
        prev.map((r) =>
          r.rideId === rideId
            ? { ...r, status: "IN_ROUTE", tripStartedAt: r.tripStartedAt ?? nowIso }
            : r
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start ride.";
      console.error("Error starting ride:", err);
      setRideActionError(message);
    } finally {
      setBusyRideId(null);
    }
  }

  async function handleCompleteRide(
    rideId: string,
    summary?: { elapsedSeconds: number; distanceMiles: number; fareCents: number }
  ) {
    if (busyRideId) return;

    setRideActionError(null);
    setBusyRideId(rideId);

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

      if (!res.ok) throw new Error(await readApiError(res));

      const data = (await res.json().catch(() => null)) as unknown;
      if (!isObject(data) || data.ok !== true) {
        const errMsg = isObject(data) && typeof data.error === "string" ? data.error : "Failed to complete ride.";
        throw new Error(errMsg);
      }

      const nowIso = new Date().toISOString();

      setAcceptedRides((prevAccepted) => {
        const ride = prevAccepted.find((r) => r.rideId === rideId);
        if (!ride) return prevAccepted;

        const completedRide: DriverRide = {
          ...ride,
          status: "COMPLETED",
          tripCompletedAt: ride.tripCompletedAt ?? nowIso,
          distanceMiles: summary?.distanceMiles ?? ride.distanceMiles ?? null,
          totalPriceCents: summary?.fareCents ?? ride.totalPriceCents ?? null,
          unreadCount: 0,
        };

        setCompletedRides((prevCompleted) => {
          const withoutThis = prevCompleted.filter((r) => r.rideId !== rideId);
          return [completedRide, ...withoutThis];
        });

        return prevAccepted.filter((r) => r.rideId !== rideId);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to complete ride.";
      console.error("Error completing ride:", err);
      setRideActionError(message);
    } finally {
      setBusyRideId(null);
    }
  }

  /* ---------- Membership banner ---------- */

  const membershipBanner = useMemo(() => {
    if (!membership) return null;

    const { state } = computeMembershipState(membership);
    const DRIVER_MONTHLY_FEE_USD = 9.99;

    const trialEndsAt = membership.trialEndsAt;
    const trialEndsLabel = formatDate(trialEndsAt);
    const daysLeft = daysUntil(trialEndsAt);

    if (state === "TRIAL") {
      const daysText =
        daysLeft === null ? "" : daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;

      return {
        tone: "warning" as const,
        title: `Free trial${daysText ? `: ${daysText}` : ""}.`,
        body: `Your trial ends ${trialEndsLabel ?? "soon"}. After that, billing will start at $${DRIVER_MONTHLY_FEE_USD}/month unless extended by admin.`,
      };
    }

    if (state === "ACTIVE") {
      return {
        tone: "good" as const,
        title: "Driver membership is active.",
        body: "Thanks — billing is active for your account.",
      };
    }

    if (state === "EXPIRED") {
      return {
        tone: "danger" as const,
        title: "Free trial has ended.",
        body: `Trial ended ${trialEndsLabel ?? ""}. You can continue testing, but once billing is enforced you may be blocked from accepting new rides until payment is active.`,
      };
    }

    return {
      tone: "warning" as const,
      title: "No membership found.",
      body: "If this is unexpected, open Membership & Billing to fix it.",
    };
  }, [membership]);

  /* ---------- Derived lists ---------- */

  const today = useMemo(() => new Date(), []);

  const sortedAcceptedRides = useMemo(() => {
    const copy = [...acceptedRides];
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
      const completedDate = safeDate(ride.tripCompletedAt) || safeDate(ride.departureTime);
      return completedDate ? isSameDay(completedDate, today) : false;
    });

    const map = new Map<string, DriverRide>();
    for (const r of todays) map.set(r.rideId, r);

    const unique = Array.from(map.values());
    unique.sort((a, b) => {
      const da = safeDate(a.tripCompletedAt || a.departureTime)?.getTime() ?? 0;
      const db = safeDate(b.tripCompletedAt || b.departureTime)?.getTime() ?? 0;
      return db - da;
    });
    return unique;
  }, [completedRides, today]);

  if (status === "loading" || !session) {
    return <p className="py-10 text-center text-slate-600">Loading…</p>;
  }

  const driverName = sessionUser?.name || "your driver";

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
        <section>
          {membershipLoading ? (
            <p className="text-xs text-slate-500">Checking membership…</p>
          ) : membershipBanner ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-xs ${
                membershipBanner.tone === "good"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : membershipBanner.tone === "danger"
                  ? "border-rose-200 bg-rose-50 text-rose-900"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              <p className="font-semibold">{membershipBanner.title}</p>
              <p className="mt-1 text-[11px] opacity-90">{membershipBanner.body}</p>

              {membershipBanner.tone !== "good" ? (
                <button
                  type="button"
                  onClick={() => router.push("/billing/membership")}
                  className="mt-2 rounded-full border border-current/20 bg-white/60 px-3 py-1 text-[11px] font-medium hover:bg-white"
                >
                  Open Membership & Billing
                </button>
              ) : null}
            </div>
          ) : null}
        </section>

        {rideActionError ? (
          <section>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900">
              <p className="font-semibold">Ride action failed</p>
              <p className="mt-1 text-[11px] opacity-90">{rideActionError}</p>
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">My accepted rides</h2>

          {ridesLoading ? (
            <p className="text-sm text-slate-500">Loading rides…</p>
          ) : ridesError ? (
            <p className="text-sm text-rose-600">{ridesError}</p>
          ) : sortedAcceptedRides.length === 0 ? (
            <p className="text-sm text-slate-500">
              You haven&apos;t accepted any rides yet. Book one from the home page.
            </p>
          ) : (
            <ul className="space-y-3">
              {sortedAcceptedRides.map((ride) => {
                const dt = safeDate(ride.departureTime) ?? new Date(ride.departureTime);

                const meterStatus: "OPEN" | "FULL" | "IN_ROUTE" | "COMPLETED" =
                  ride.status === "IN_ROUTE"
                    ? "IN_ROUTE"
                    : ride.status === "COMPLETED"
                    ? "COMPLETED"
                    : "OPEN";

                const isInRoute = ride.status === "IN_ROUTE";
                const canChat = !!ride.conversationId?.trim();
                const chatDisabled = !canChat || isInRoute;
                const riderLabel = ride.riderPublicId || ride.riderName || "there";
                const isBusy = busyRideId === ride.rideId;

                const unread = ride.unreadCount ?? 0;

                return (
                  <li
                    key={`${ride.rideId}-${ride.bookingId ?? "nobook"}-${ride.departureTime}`}
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
                        Rider: <span className="font-medium text-slate-800">{riderLabel}</span>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (isInRoute) return;
                          router.push(`/driver/rides/${ride.rideId}`);
                        }}
                        disabled={isInRoute || isBusy}
                        className={`rounded-full px-4 py-2 text-xs font-medium text-white ${
                          isInRoute || isBusy
                            ? "cursor-not-allowed bg-slate-400 opacity-60"
                            : "bg-slate-900 hover:bg-slate-800"
                        }`}
                      >
                        View trip details
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          if (chatDisabled || !ride.conversationId) return;

                          await markConversationRead(ride.conversationId);

                          setAcceptedRides((prev) =>
                            prev.map((r) =>
                              r.rideId === ride.rideId ? { ...r, unreadCount: 0 } : r
                            )
                          );

                          const riderFirst = String(riderLabel).trim().split(" ")[0];
                          const driverFirst = String(driverName).trim().split(" ")[0];

                          setActiveChat({
                            conversationId: ride.conversationId,
                            prefill: `Hi ${riderFirst}, this is ${driverFirst}. I will be at your location in 10 minutes.`,
                            autoClose: true,
                            readOnly: false,
                          });
                        }}
                        disabled={chatDisabled || isBusy}
                        className={`relative rounded-full px-4 py-2 text-xs font-medium text-white ${
                          chatDisabled || isBusy
                            ? "cursor-not-allowed bg-slate-300 opacity-60"
                            : "bg-indigo-600 hover:bg-indigo-700"
                        }`}
                      >
                        View chat
                        {unread > 0 ? (
                          <span className="ml-2 inline-flex items-center justify-center rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                            {unread > 99 ? "99+" : unread}
                          </span>
                        ) : null}
                      </button>
                    </div>

                    <TripMeter
                      status={meterStatus}
                      tripStartedAt={ride.tripStartedAt}
                      tripCompletedAt={ride.tripCompletedAt}
                      onStartRide={() => handleStartRide(ride.rideId)}
                      onCompleteRide={(summary) => handleCompleteRide(ride.rideId, summary)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">Rides completed today</h2>

          {ridesLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : dedupedTodayCompletedRides.length === 0 ? (
            <p className="text-sm text-slate-500">No rides completed today.</p>
          ) : (
            <ul className="space-y-3">
              {dedupedTodayCompletedRides.map((ride) => {
                const dt =
                  safeDate(ride.tripCompletedAt) ??
                  safeDate(ride.departureTime) ??
                  new Date(ride.departureTime);

                const canChat = !!ride.conversationId?.trim();
                const riderLabel = ride.riderPublicId || ride.riderName || "there";

                return (
                  <li
                    key={`${ride.bookingId ?? "nobook"}-${ride.rideId}-${ride.tripCompletedAt ?? ride.departureTime}`}
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
                        Rider: <span className="font-medium text-slate-800">{riderLabel}</span>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => router.push(`/driver/rides/${ride.rideId}`)}
                        className="rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
                      >
                        View trip details
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (!ride.bookingId) return;
                          router.push(`/receipt/${ride.bookingId}`);
                        }}
                        disabled={!ride.bookingId}
                        className={`rounded-full border px-4 py-2 text-xs font-medium ${
                          ride.bookingId
                            ? "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                            : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                        }`}
                      >
                        View receipt
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          if (!canChat || !ride.conversationId) return;

                          await markConversationRead(ride.conversationId);

                          setCompletedRides((prev) =>
                            prev.map((r) =>
                              r.rideId === ride.rideId ? { ...r, unreadCount: 0 } : r
                            )
                          );

                          setActiveChat({
                            conversationId: ride.conversationId,
                            prefill: null,
                            autoClose: false,
                            readOnly: true,
                          });
                        }}
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

        {/* Service area UI left as-is */}
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Driver service area</h1>
          <p className="text-sm text-slate-600">
            Add the cities where you regularly work. For now, keep your area local (within about 10 miles). Later
            we&apos;ll automatically enforce distance limits and use these cities to match you with rider requests.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-800">My service cities</h2>

          {serviceLoading ? (
            <p className="text-sm text-slate-500">Loading service area…</p>
          ) : serviceCities.length === 0 ? (
            <p className="text-sm text-slate-500">You haven&apos;t added any cities yet.</p>
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
                    aria-label={`Remove ${city.cityName}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Add a city</h2>
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
          {cityError ? <p className="mt-2 text-xs text-rose-600">{cityError}</p> : null}
        </section>
      </div>

      {activeChat ? <ChatOverlay context={activeChat} onClose={() => setActiveChat(null)} /> : null}
    </main>
  );
}

/* ---------- Chat overlay (driver side) ---------- */

function ChatOverlay(props: { context: ActiveChatContext; onClose: () => void }) {
  const { context, onClose } = props;
  const { conversationId, prefill, autoClose, readOnly } = context;

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (isObject(event?.data) && event.data.type === "ridechat:close") onClose();
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onClose]);

  const params = new URLSearchParams();
  params.set("embed", "1");
  params.set("role", "driver");

  if (readOnly) params.set("readonly", "1");
  if (autoClose) params.set("autoClose", "1");
  if (prefill) params.set("prefill", prefill);

  const src = `/chat/${conversationId}?${params.toString()}`;

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
        <iframe src={src} title="Driver chat" className="h-full w-full border-0" />
      </div>
    </div>
  );
}
