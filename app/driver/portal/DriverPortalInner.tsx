"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { TripMeter } from "@/components/driver/TripMeter";
import { asRole } from "@/lib/roles";
import {
  computeMembershipState,
  formatDate,
  type MeMembership,
} from "@/lib/membership";
import { daysUntil } from "@/lib/dateUtils";

/**
 * IMPORTANT:
 * Unread badge polling must NOT fetch /api/chat/:conversationId for many convos.
 * With Prisma pool limit=1, that can cause P2024 and make chat + ride actions hang/fail.
 *
 * This file uses a cheap notifications endpoint:
 *   GET /api/driver/chat-notifications
 */
const ENABLE_UNREAD_BADGE = true;

type ServiceCity = {
  id: string;
  cityName: string;
  cityLat: number;
  cityLng: number;
};

type DriverProfileResponse = any;

type RideStatusUI = "OPEN" | "ACCEPTED" | "IN_ROUTE" | "COMPLETED" | "CANCELLED";

type DriverRide = {
  rideId: string;

  bookingId: string | null;
  paymentType?: "CARD" | "CASH" | null;

  originCity: string;
  destinationCity: string;
  departureTime: string; // ISO
  status: RideStatusUI;

  riderName: string | null;
  riderPublicId: string | null;

  conversationId: string | null;

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
  | { ok: true; membership: MeMembership & { status?: string | null } }
  | { ok: false; error: string };

type UnreadCounts = Record<string, number>;

type DriverConversationNotification = {
  conversationId: string;
  latestMessageId: string | null;
  latestMessageCreatedAt: string | null;
  latestMessageSenderId: string | null;
  senderType: "RIDER" | "DRIVER" | "UNKNOWN";
};

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

function formatMoneyFromCents(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return null;
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

async function readApiError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return `Request failed (HTTP ${res.status}).`;

  try {
    const json = JSON.parse(text);
    return (
      json?.error || json?.message || `Request failed (HTTP ${res.status}).`
    );
  } catch {
    return text.slice(0, 300) || `Request failed (HTTP ${res.status}).`;
  }
}

/** messageId-based "seen" store for driver */
function getDriverSeenMessageId(conversationId: string): string | null {
  try {
    return localStorage.getItem(`chat:lastSeenMsgId:driver:${conversationId}`);
  } catch {
    return null;
  }
}

function setDriverSeenMessageId(conversationId: string, messageId: string | null) {
  try {
    if (!messageId) return;
    localStorage.setItem(`chat:lastSeenMsgId:driver:${conversationId}`, messageId);
  } catch {
    // ignore
  }
}

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

  const [unread, setUnread] = useState<UnreadCounts>({});

  const unreadPollRef = useRef<number | null>(null);
  const latestByConvRef = useRef<Record<string, string | null>>({});

  const driverName =
    ((session?.user as any)?.name as string | undefined) || "your driver";

  async function loadRides() {
    setRidesLoading(true);
    try {
      const res = await fetch("/api/driver/portal-rides", { cache: "no-store" });
      const data: PortalRidesResponse = await res
        .json()
        .catch(() => ({ ok: false, error: "Bad JSON" } as any));

      if (!res.ok || !data.ok) {
        throw new Error((data as any)?.error || "Failed to load rides.");
      }

      const normalize = (r: any): DriverRide => ({
        rideId: r.rideId ?? r.id,
        bookingId: r.bookingId ?? null,
        paymentType: r.paymentType ?? null,

        originCity: r.originCity,
        destinationCity: r.destinationCity,
        departureTime: r.departureTime,
        status: r.status,

        riderName: r.riderName ?? null,
        riderPublicId: r.riderPublicId ?? null,
        conversationId: r.conversationId ?? null,

        tripStartedAt: r.tripStartedAt ?? null,
        tripCompletedAt: r.tripCompletedAt ?? null,
        distanceMiles: r.distanceMiles ?? null,
        totalPriceCents: r.totalPriceCents ?? null,
      });

      const accepted = (data as any).accepted?.map(normalize) ?? [];
      const completed = (data as any).completed?.map(normalize) ?? [];

      setAcceptedRides(accepted);
      setCompletedRides(completed);
      setRidesError(null);
    } catch (err: any) {
      console.error("Error loading driver rides:", err);
      setRidesError(err?.message || "Could not load rides.");
    } finally {
      setRidesLoading(false);
    }
  }

  // Session + initial load
  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace("/auth/login?callbackUrl=/driver/portal");
      return;
    }

    const role = asRole((session.user as any)?.role);

    // driver portal: DRIVER (optionally ADMIN)
    if (role !== "DRIVER" && role !== "ADMIN") {
      router.replace("/");
      return;
    }

    async function loadProfile() {
      try {
        const res = await fetch("/api/driver/service-cities", {
          cache: "no-store",
        });
        const data: DriverProfileResponse = await res.json().catch(() => null);
        const profile =
          (data?.ok && data?.profile) ||
          data?.driverProfile ||
          data?.profile ||
          null;

        if (res.ok && profile?.serviceCities) {
          setServiceCities(profile.serviceCities);
        }
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
          setMembership(null);
          return;
        }

        setMembership((json as any).membership);
      } catch (err) {
        console.error("Error loading membership:", err);
        setMembership(null);
      } finally {
        setMembershipLoading(false);
      }
    }

    loadProfile();
    loadMembership();
    loadRides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status, router]);

  // Auto-open chat from query params
  useEffect(() => {
    if (activeChat) return;

    const sp = searchParams ?? new URLSearchParams();
    const convId = sp.get("conversationId");
    if (!convId) return;

    const autoOpenChat = sp.get("autoOpenChat") === "1";
    const prefillParam = sp.get("prefill");

    // If prefill param exists (even empty), open exactly that
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
      setActiveChat({
        conversationId: convId,
        prefill: null,
        autoClose: true,
        readOnly: false,
      });
      router.replace("/driver/portal");
      return;
    }

    const riderLabel = ride.riderPublicId || ride.riderName || "there";
    const riderFirst = String(riderLabel).trim().split(" ")[0];
    const driverFirst = String(driverName).trim().split(" ")[0];

    setActiveChat({
      conversationId: convId,
      prefill: `Hi ${riderFirst}, this is ${driverFirst}. I will be at your location in 10 minutes.`,
      autoClose: true,
      readOnly: false,
    });

    router.replace("/driver/portal");
  }, [searchParams, activeChat, ridesLoading, acceptedRides, router, driverName]);

  /**
   * Unread polling (driver)
   * - Polls /api/driver/chat-notifications every 8s
   * - Only shows a badge when latest message is from RIDER AND differs from last seen messageId
   * - Sticky-until-open: once badge is 1, it stays 1 until driver opens chat
   *
   * FIX:
   * - Completed rides should NOT keep a sticky badge. Once a ride is completed, clear the badge.
   * - Only poll for accepted rides' conversations (active work).
   */
  useEffect(() => {
    if (!ENABLE_UNREAD_BADGE) {
      setUnread({});
      return;
    }
    if (status !== "authenticated") return;

    const driverUserId = (session?.user as any)?.id as string | undefined;
    if (!driverUserId) return;

    const acceptedConvIds = Array.from(
      new Set(
        acceptedRides
          .map((r) => r.conversationId?.trim() || "")
          .filter(Boolean)
      )
    );

    const completedConvIds = Array.from(
      new Set(
        completedRides
          .map((r) => r.conversationId?.trim() || "")
          .filter(Boolean)
      )
    );

    // clear any existing interval
    if (unreadPollRef.current) {
      window.clearInterval(unreadPollRef.current);
      unreadPollRef.current = null;
    }

    // Always clear badges for completed convos (even if we don't poll)
    if (completedConvIds.length > 0) {
      setUnread((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id of completedConvIds) {
          if ((next[id] ?? 0) !== 0) {
            next[id] = 0;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }

    // If no accepted convos, nothing to poll
    if (acceptedConvIds.length === 0) return;

    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/driver/chat-notifications", {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok) return;

        const data = (await res.json()) as
          | { ok: true; notifications: DriverConversationNotification[] }
          | { ok: false; error: string };

        if (cancelled || !data.ok) return;

        const list = data.notifications || [];
        const activeConvId = activeChat?.conversationId ?? null;

        // keep latest messageId in a ref so openChat can mark it seen without another fetch
        const nextLatest: Record<string, string | null> = {
          ...latestByConvRef.current,
        };

        const nextUnread: Record<string, number> = {};

        // Force-clear completed convos on every poll (sticky badge should not persist there)
        for (const completedId of completedConvIds) {
          nextUnread[completedId] = 0;

          // Optional: if we already know a latest message id, mark it seen so it doesn't re-trigger later
          const knownLatest = nextLatest[completedId] ?? null;
          if (knownLatest) setDriverSeenMessageId(completedId, knownLatest);
        }

        for (const n of list) {
          const convId = n.conversationId;

          // Only consider accepted rides for unread/sticky behavior
          if (!acceptedConvIds.includes(convId)) continue;

          const latestId = n.latestMessageId ?? null;
          nextLatest[convId] = latestId;

          // if chat is open for this conversation, mark as seen and clear
          if (activeConvId && convId === activeConvId) {
            nextUnread[convId] = 0;
            if (latestId) setDriverSeenMessageId(convId, latestId);
            continue;
          }

          if (!latestId) {
            nextUnread[convId] = 0;
            continue;
          }

          const seenId = getDriverSeenMessageId(convId);
          const isNewRiderMsg = n.senderType === "RIDER" && latestId !== seenId;

          nextUnread[convId] = isNewRiderMsg ? 1 : 0;
        }

        latestByConvRef.current = nextLatest;

        setUnread((prev) => {
          let changed = false;
          const merged = { ...prev };

          // Merge with sticky-until-open logic for accepted convos only.
          for (const [convId, freshValue] of Object.entries(nextUnread)) {
            const prevValue = merged[convId] ?? 0;

            const isAccepted = acceptedConvIds.includes(convId);
            const isCompleted = completedConvIds.includes(convId);

            // Completed: always 0 (no sticky)
            if (isCompleted) {
              const finalValue = 0;
              if (prevValue !== finalValue) {
                merged[convId] = finalValue;
                changed = true;
              }
              continue;
            }

            // Accepted: sticky until open
            if (isAccepted) {
              const finalValue = freshValue === 1 ? 1 : prevValue;
              if (prevValue !== finalValue) {
                merged[convId] = finalValue;
                changed = true;
              }
              continue;
            }

            // Anything else: keep as-is (shouldn't happen)
          }

          return changed ? merged : prev;
        });
      } catch (e) {
        console.error("Driver chat notification poll failed:", e);
      }
    }

    poll();
    unreadPollRef.current = window.setInterval(poll, 8_000);

    return () => {
      cancelled = true;
      if (unreadPollRef.current) {
        window.clearInterval(unreadPollRef.current);
        unreadPollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status, acceptedRides, completedRides, activeChat]);

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

      const data = await res.json().catch(() => null);
      if (!data?.ok) throw new Error(data?.error || "Failed to add city");

      setServiceCities((prev) => [...prev, data.city]);
      setCityName("");
    } catch (err: any) {
      console.error("Error adding service city:", err);
      setCityError(err?.message || "Something went wrong");
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

      const data = await res.json().catch(() => null);
      if (!data?.ok) throw new Error(data?.error || "Failed to remove city");

      setServiceCities((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error("Error removing service city:", err);
    }
  }

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

      const data = await res.json().catch(() => null);
      if (!data?.ok) throw new Error(data?.error || "Failed to start ride.");

      const nowIso = new Date().toISOString();
      setAcceptedRides((prev) =>
        prev.map((r) =>
          r.rideId === rideId
            ? { ...r, status: "IN_ROUTE", tripStartedAt: r.tripStartedAt ?? nowIso }
            : r
        )
      );
    } catch (err: any) {
      console.error("Error starting ride:", err);
      setRideActionError(err?.message || "Failed to start ride.");
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

      const data = await res.json().catch(() => null);
      if (!data?.ok) throw new Error(data?.error || "Failed to complete ride.");

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
        };

        // Also clear unread badge immediately when ride completes
        if (ENABLE_UNREAD_BADGE && completedRide.conversationId) {
          const cid = completedRide.conversationId;
          setUnread((prev) => ({ ...prev, [cid]: 0 }));
          const latestId = latestByConvRef.current[cid] ?? null;
          if (latestId) setDriverSeenMessageId(cid, latestId);
        }

        setCompletedRides((prevCompleted) => [
          completedRide,
          ...prevCompleted.filter((r) => r.rideId !== rideId),
        ]);

        return prevAccepted.filter((r) => r.rideId !== rideId);
      });
    } catch (err: any) {
      console.error("Error completing ride:", err);
      setRideActionError(err?.message || "Failed to complete ride.");
    } finally {
      setBusyRideId(null);
    }
  }

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

  function renderUnreadBadge(conversationId: string | null) {
    if (!ENABLE_UNREAD_BADGE) return null;
    if (!conversationId) return null;

    const n = unread[conversationId] ?? 0;
    if (n <= 0) return null;

    return (
      <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">
        {n}
      </span>
    );
  }

  function openChat(args: {
    conversationId: string;
    readOnly: boolean;
    prefill: string | null;
    autoClose: boolean;
  }) {
    // clear badge immediately
    if (ENABLE_UNREAD_BADGE) {
      setUnread((prev) => ({ ...prev, [args.conversationId]: 0 }));
    }

    // mark latest messageId as seen (so badge stays cleared)
    const latestId = latestByConvRef.current[args.conversationId] ?? null;
    if (latestId) setDriverSeenMessageId(args.conversationId, latestId);

    setActiveChat({
      conversationId: args.conversationId,
      prefill: args.prefill,
      autoClose: args.autoClose,
      readOnly: args.readOnly,
    });
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
        <section className="flex items-center justify-between">
          <div>
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
          </div>

          <button
            type="button"
            onClick={loadRides}
            className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
          >
            Refresh
          </button>
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
            <p className="text-sm text-slate-500">You haven&apos;t accepted any rides yet.</p>
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

                const priceLabel = formatMoneyFromCents(ride.totalPriceCents);
                const payLabel = ride.paymentType ? String(ride.paymentType) : null;

                return (
                  <li
                    key={ride.rideId}
                    className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {ride.originCity} → {ride.destinationCity}
                      </p>
                      <p className="text-xs text-slate-500">
                        {dt.toLocaleString()} • Status: {ride.status}
                        {payLabel ? ` • Pay: ${payLabel}` : ""}
                        {priceLabel ? ` • Fare: ${priceLabel}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Rider:{" "}
                        <span className="font-medium text-slate-800">{riderLabel}</span>
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
                        onClick={() => {
                          if (chatDisabled || !ride.conversationId) return;

                          const riderFirst = String(riderLabel).trim().split(" ")[0];
                          const driverFirst = String(driverName).trim().split(" ")[0];

                          openChat({
                            conversationId: ride.conversationId,
                            readOnly: false,
                            autoClose: true,
                            prefill: `Hi ${riderFirst}, this is ${driverFirst}. I will be at your location in 10 minutes.`,
                          });
                        }}
                        disabled={chatDisabled || isBusy}
                        className={`rounded-full px-4 py-2 text-xs font-medium text-white ${
                          chatDisabled || isBusy
                            ? "cursor-not-allowed bg-slate-300 opacity-60"
                            : "bg-indigo-600 hover:bg-indigo-700"
                        }`}
                      >
                        <span className="inline-flex items-center gap-2">
                          View chat
                          {renderUnreadBadge(ride.conversationId)}
                        </span>
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
                const priceLabel = formatMoneyFromCents(ride.totalPriceCents);

                return (
                  <li
                    key={ride.rideId}
                    className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {ride.originCity} → {ride.destinationCity}
                      </p>
                      <p className="text-xs text-slate-500">
                        {dt.toLocaleString()} • Status: {ride.status}
                        {priceLabel ? ` • Fare: ${priceLabel}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Rider:{" "}
                        <span className="font-medium text-slate-800">{riderLabel}</span>
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
                        onClick={() => {
                          if (!canChat || !ride.conversationId) return;
                          openChat({
                            conversationId: ride.conversationId,
                            readOnly: true,
                            autoClose: false,
                            prefill: null,
                          });
                        }}
                        disabled={!canChat}
                        className={`rounded-full border px-4 py-2 text-xs font-medium ${
                          canChat
                            ? "border-slate-300 text-slate-800 hover:bg-slate-50"
                            : "cursor-not-allowed border-slate-200 text-slate-400"
                        }`}
                      >
                        <span className="inline-flex items-center gap-2">
                          View chat
                          {renderUnreadBadge(ride.conversationId)}
                        </span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Driver service area</h1>
          <p className="text-sm text-slate-600">
            Add the cities where you regularly work. For now, keep your area local (within about 10 miles).
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

function ChatOverlay(props: { context: ActiveChatContext; onClose: () => void }) {
  const { context, onClose } = props;
  const { conversationId, prefill, autoClose, readOnly } = context;

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event?.data?.type === "ridechat:close") onClose();
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
