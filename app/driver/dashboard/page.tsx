"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { formatUsdFromCents } from "@/lib/money";

type DashboardRide = {
  id: string;
  departureTime: string;
  departureTimeMs?: number;
  status: string;

  // legacy fallback from older API
  totalPriceCents: number;

  distanceMiles: number;
  originCity: string;
  destinationCity: string;

  // newer optional accounting fields
  driverNetCents?: number | null;
  grossAmountCents?: number | null;
  platformFeeCents?: number | null;

  paymentType?: "CARD" | "CASH" | null;
  originalPaymentType?: "CARD" | "CASH" | null;

  cashNotPaidAt?: string | null;
  fallbackCardChargedAt?: string | null;

  refundIssued?: boolean | null;
  refundAmountCents?: number | null;

  settlementLabel?: string | null;
};

type DashboardStatsResponse =
  | { ok: true; rides: DashboardRide[] }
  | { ok: false; error: string };

type RangeKey =
  | "TODAY"
  | "YESTERDAY"
  | "THIS_WEEK"
  | "THIS_MONTH"
  | "THIS_YEAR"
  | "ALL"
  | "CUSTOM";

type NonCustomRange = Exclude<RangeKey, "CUSTOM">;

/* ---------- Date helpers ---------- */

function safeDate(value: unknown): Date | null {
  if (value == null) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === "string") {
    const s = value.trim();

    if (/^\d{10,17}$/.test(s)) {
      const num = Number(s);
      if (!Number.isFinite(num)) return null;
      const d = new Date(num);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfWeekMonday(now: Date) {
  const d = startOfDay(now);
  const day = d.getDay();
  const diffToMonday = (day + 6) % 7;
  d.setDate(d.getDate() - diffToMonday);
  return d;
}

function filterByPresetRange(
  rides: { dt: Date; raw: DashboardRide }[],
  range: NonCustomRange
) {
  const now = new Date();

  if (range === "ALL") return rides;

  if (range === "TODAY") {
    return rides.filter((r) => isSameDay(r.dt, now));
  }

  if (range === "YESTERDAY") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return rides.filter((r) => isSameDay(r.dt, y));
  }

  if (range === "THIS_WEEK") {
    const start = startOfWeekMonday(now);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return rides.filter((r) => r.dt >= start && r.dt < end);
  }

  if (range === "THIS_MONTH") {
    const year = now.getFullYear();
    const month = now.getMonth();
    const start = new Date(year, month, 1, 0, 0, 0, 0);
    const end = new Date(year, month + 1, 1, 0, 0, 0, 0);
    return rides.filter((r) => r.dt >= start && r.dt < end);
  }

  if (range === "THIS_YEAR") {
    const year = now.getFullYear();
    const start = new Date(year, 0, 1, 0, 0, 0, 0);
    const end = new Date(year + 1, 0, 1, 0, 0, 0, 0);
    return rides.filter((r) => r.dt >= start && r.dt < end);
  }

  return rides;
}

function filterByCustomRange(
  rides: { dt: Date; raw: DashboardRide }[],
  startDateStr: string | null,
  endDateStr: string | null
) {
  if (!startDateStr || !endDateStr) return [];

  const startRaw = safeDate(startDateStr);
  const endRaw = safeDate(endDateStr);
  if (!startRaw || !endRaw) return [];

  const start = startOfDay(startRaw);
  const end = endOfDay(endRaw);

  if (start > end) return [];

  return rides.filter((r) => r.dt >= start && r.dt <= end);
}

function formatLocalDateTime(dt: Date): { datePart: string; timePart: string } {
  return {
    datePart: dt.toLocaleDateString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    timePart: dt.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

function asNonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function getRideEarningsCents(ride: DashboardRide): number {
  const directNet = asNonNegativeInt(ride.driverNetCents);
  if (directNet !== null) return directNet;

  const gross = asNonNegativeInt(ride.grossAmountCents);
  const fee = asNonNegativeInt(ride.platformFeeCents);

  const originallyCash = ride.originalPaymentType === "CASH";
  const fallbackCharged = Boolean(
    originallyCash &&
      ride.paymentType === "CARD" &&
      ride.cashNotPaidAt &&
      ride.fallbackCardChargedAt
  );
  const refundedAfterDispute = Boolean(
    ride.refundIssued &&
      (asNonNegativeInt(ride.refundAmountCents) ?? 0) > 0
  );
  const preservedCashAccounting = fallbackCharged && refundedAfterDispute;

  if (preservedCashAccounting && gross !== null && fee !== null) {
    return Math.max(0, gross - fee);
  }

  if (
    typeof ride.settlementLabel === "string" &&
    ride.settlementLabel.toLowerCase().includes("cash preserved") &&
    gross !== null &&
    fee !== null
  ) {
    return Math.max(0, gross - fee);
  }

  const legacy = asNonNegativeInt(ride.totalPriceCents);
  return legacy ?? 0;
}

/* ---------- Page ---------- */

const RANGE_OPTIONS: [RangeKey, string][] = [
  ["TODAY", "Today"],
  ["YESTERDAY", "Yesterday"],
  ["THIS_WEEK", "This week"],
  ["THIS_MONTH", "This month"],
  ["THIS_YEAR", "This year"],
  ["ALL", "All time"],
  ["CUSTOM", "Custom"],
];

export default function DriverDashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [rides, setRides] = useState<DashboardRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [range, setRange] = useState<RangeKey>("TODAY");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace("/auth/login?callbackUrl=/driver/dashboard");
      return;
    }

    const role = (session.user as { role?: string } | undefined)?.role;

    if (role !== "DRIVER" && role !== "ADMIN") {
      router.replace("/");
      return;
    }

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/driver/dashboard-stats");
        const data: DashboardStatsResponse = await res.json();

        if (!res.ok || !("ok" in data) || !data.ok) {
          throw new Error(
            (data as { error?: string } | undefined)?.error ||
              "Failed to load stats."
          );
        }

        setRides(data.rides ?? []);
      } catch (e: unknown) {
        setError(
          e instanceof Error ? e.message : "Could not load dashboard."
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [session, status, router]);

  const normalizedCompleted = useMemo(() => {
    const completed = rides.filter(
      (r) => String(r.status || "").toUpperCase() === "COMPLETED"
    );

    const withDates = completed
      .map((raw) => {
        const dt =
          safeDate(raw.departureTimeMs) ?? safeDate(raw.departureTime) ?? null;
        return dt ? { dt, raw } : null;
      })
      .filter(Boolean) as { dt: Date; raw: DashboardRide }[];

    withDates.sort((a, b) => b.dt.getTime() - a.dt.getTime());
    return withDates;
  }, [rides]);

  const filtered = useMemo(() => {
    if (range === "CUSTOM") {
      return filterByCustomRange(
        normalizedCompleted,
        customStart || null,
        customEnd || null
      );
    }
    return filterByPresetRange(normalizedCompleted, range as NonCustomRange);
  }, [normalizedCompleted, range, customStart, customEnd]);

  const totals = useMemo(() => {
    const ridesCount = filtered.length;
    const totalMiles = filtered.reduce(
      (sum, r) => sum + (r.raw.distanceMiles ?? 0),
      0
    );
    const totalEarningsCents = filtered.reduce(
      (sum, r) => sum + getRideEarningsCents(r.raw),
      0
    );
    const avgPerRideCents = ridesCount
      ? Math.round(totalEarningsCents / ridesCount)
      : 0;

    return { ridesCount, totalMiles, totalEarningsCents, avgPerRideCents };
  }, [filtered]);

  const isCustomActive = range === "CUSTOM";
  const customHasBothDates = !!customStart && !!customEnd;

  if (status === "loading") {
    return <p className="py-10 text-center text-slate-600">Loading…</p>;
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Driver earnings dashboard
            </h1>
            <p className="text-sm text-slate-600">
              See your completed rides, distance, and earnings over time.
            </p>
          </div>

          <div className="inline-flex flex-wrap gap-2 rounded-full border border-slate-200 bg-white p-1 shadow-sm">
            {RANGE_OPTIONS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setRange(key)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  range === key
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {isCustomActive && (
          <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Custom date range
            </p>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600">From</span>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600">To</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {!customHasBothDates && (
              <p className="text-[11px] text-slate-500">
                Select both start and end date to apply the custom range.
              </p>
            )}
          </section>
        )}

        {loading ? (
          <p className="text-sm text-slate-500">Loading stats…</p>
        ) : error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : null}

        {!loading && !error && (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Total earnings
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {formatUsdFromCents(totals.totalEarningsCents)}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                In selected period
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Completed rides
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {totals.ridesCount}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Status: COMPLETED only
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Total miles
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {totals.totalMiles.toFixed(1)}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Based on stored distanceMiles
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Avg per ride
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {formatUsdFromCents(totals.avgPerRideCents)}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Average payout per completed ride
              </p>
            </div>
          </section>
        )}

        {!loading && !error && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">
              Rides in selected period
            </h2>

            {filtered.length === 0 ? (
              <p className="text-sm text-slate-500">
                {range === "CUSTOM" && customHasBothDates
                  ? "No completed rides found in this custom range."
                  : "No completed rides found for this range."}
              </p>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="max-h-[420px] overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-2 text-left">Date</th>
                        <th className="px-4 py-2 text-left">Route</th>
                        <th className="px-4 py-2 text-right">Miles</th>
                        <th className="px-4 py-2 text-right">Earnings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(({ dt, raw }) => {
                        const { datePart, timePart } = formatLocalDateTime(dt);
                        const earningsCents = getRideEarningsCents(raw);

                        return (
                          <tr
                            key={raw.id}
                            className="cursor-pointer border-t border-slate-100 hover:bg-slate-50/60"
                            onClick={() => router.push(`/driver/rides/${raw.id}`)}
                          >
                            <td className="px-4 py-2 align-middle text-slate-700">
                              {datePart}{" "}
                              {timePart && (
                                <span className="text-[11px] text-slate-400">
                                  {timePart}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 align-middle text-slate-700">
                              {raw.originCity} → {raw.destinationCity}
                            </td>
                            <td className="px-4 py-2 text-right align-middle text-slate-700">
                              {(raw.distanceMiles ?? 0).toFixed(1)}
                            </td>
                            <td className="px-4 py-2 text-right align-middle text-slate-900">
                              {formatUsdFromCents(earningsCents)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
                  Click a row to open full ride details.
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}