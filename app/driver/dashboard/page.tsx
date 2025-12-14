"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

type DashboardRide = {
  id: string;
  departureTime: string; // ISO
  status: string;
  totalPriceCents: number;
  distanceMiles: number;
  originCity: string;
  destinationCity: string;
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

/* ---------- Helpers ---------- */

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function filterByPresetRange(
  rides: DashboardRide[],
  range: NonCustomRange
): DashboardRide[] {
  const now = new Date();

  if (range === "ALL") return rides;

  if (range === "TODAY") {
    return rides.filter((r) => isSameDay(new Date(r.departureTime), now));
  }

  if (range === "YESTERDAY") {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return rides.filter((r) =>
      isSameDay(new Date(r.departureTime), yesterday)
    );
  }

  if (range === "THIS_WEEK") {
    // Monday–Sunday of the current week, in local time
    const startOfWeek = new Date(now);
    const day = startOfWeek.getDay(); // 0 (Sun) - 6 (Sat)
    const diffToMonday = (day + 6) % 7; // days since Monday
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(startOfWeek.getDate() - diffToMonday);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 7); // exclusive

    return rides.filter((r) => {
      const d = new Date(r.departureTime);
      return d >= startOfWeek && d < endOfWeek;
    });
  }

  if (range === "THIS_MONTH") {
    const year = now.getFullYear();
    const month = now.getMonth(); // 0–11

    const startOfMonth = new Date(year, month, 1, 0, 0, 0, 0);
    const startOfNextMonth = new Date(year, month + 1, 1, 0, 0, 0, 0);

    return rides.filter((r) => {
      const d = new Date(r.departureTime);
      return d >= startOfMonth && d < startOfNextMonth;
    });
  }

  if (range === "THIS_YEAR") {
    const year = now.getFullYear();
    const startOfYear = new Date(year, 0, 1, 0, 0, 0, 0);
    const startOfNextYear = new Date(year + 1, 0, 1, 0, 0, 0, 0);

    return rides.filter((r) => {
      const d = new Date(r.departureTime);
      return d >= startOfYear && d < startOfNextYear;
    });
  }

  return rides;
}

function filterByCustomRange(
  rides: DashboardRide[],
  startDateStr: string | null,
  endDateStr: string | null
): DashboardRide[] {
  if (!startDateStr || !endDateStr) return [];

  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  // Normalize to full-day inclusive range in local time
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return [];
  }

  return rides.filter((r) => {
    const d = new Date(r.departureTime);
    return d >= start && d <= end;
  });
}

/**
 * Always returns an object so TS is happy and we always render something.
 * Uses the user's local time zone via `toLocale*`.
 */
function formatLocalDateTime(iso: string): { datePart: string; timePart: string } {
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) {
    return { datePart: "Invalid date", timePart: "" };
  }

  const datePart = dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const timePart = dt.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return { datePart, timePart };
}

/* ---------- Page ---------- */

export default function DriverDashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [rides, setRides] = useState<DashboardRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("TODAY");

  // Custom range state (YYYY-MM-DD)
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace("/auth/login?callbackUrl=/driver/dashboard");
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

    async function loadStats() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/driver/dashboard-stats");
        const data: DashboardStatsResponse = await res.json();

        if (!res.ok || !("ok" in data) || !data.ok) {
          throw new Error((data as any)?.error || "Failed to load stats.");
        }

        setRides(data.rides);
      } catch (err: any) {
        console.error(err);
        setError(err.message || "Could not load dashboard.");
      } finally {
        setLoading(false);
      }
    }

    loadStats();
  }, [session, status, router]);

  const filteredRides = useMemo(() => {
    if (range === "CUSTOM") {
      return filterByCustomRange(
        rides,
        customStart || null,
        customEnd || null
      );
    }
    return filterByPresetRange(rides, range as NonCustomRange);
  }, [rides, range, customStart, customEnd]);

  const totals = useMemo(() => {
    if (filteredRides.length === 0) {
      return {
        ridesCount: 0,
        totalMiles: 0,
        totalEarningsCents: 0,
        avgPerRideCents: 0,
      };
    }

    const ridesCount = filteredRides.length;
    const totalMiles = filteredRides.reduce(
      (sum, r) => sum + (r.distanceMiles ?? 0),
      0
    );
    const totalEarningsCents = filteredRides.reduce(
      (sum, r) => sum + (r.totalPriceCents ?? 0),
      0
    );
    const avgPerRideCents =
      ridesCount > 0 ? totalEarningsCents / ridesCount : 0;

    return {
      ridesCount,
      totalMiles,
      totalEarningsCents,
      avgPerRideCents,
    };
  }, [filteredRides]);

  const totalEarningsDollars = (totals.totalEarningsCents / 100).toFixed(2);
  const avgPerRideDollars = (totals.avgPerRideCents / 100).toFixed(2);

  if (status === "loading") {
    return <p className="py-10 text-center text-slate-600">Loading…</p>;
  }

  const isCustomActive = range === "CUSTOM";
  const customHasBothDates = !!customStart && !!customEnd;

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Driver earnings dashboard
            </h1>
            <p className="text-sm text-slate-600">
              See your completed rides, distance, and earnings over time.
            </p>
          </div>

          {/* Range selector */}
          <div className="inline-flex flex-wrap gap-2 rounded-full bg-white p-1 shadow-sm border border-slate-200">
            {(
              [
                ["TODAY", "Today"],
                ["YESTERDAY", "Yesterday"],
                ["THIS_WEEK", "This week"],
                ["THIS_MONTH", "This month"],
                ["THIS_YEAR", "This year"],
                ["ALL", "All time"],
                ["CUSTOM", "Custom"],
              ] as [RangeKey, string][]
            ).map(([key, label]) => (
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

        {/* Custom range picker */}
        {isCustomActive && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Custom date range
            </p>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-slate-600 text-xs">From</span>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-600 text-xs">To</span>
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

        {/* Error / loading */}
        {loading ? (
          <p className="text-sm text-slate-500">Loading stats…</p>
        ) : error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : null}

        {/* Summary cards */}
        {!loading && !error && (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Total earnings
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                ${totalEarningsDollars}
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
                ${avgPerRideDollars}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Average payout per completed ride
              </p>
            </div>
          </section>
        )}

        {/* Rides table */}
        {!loading && !error && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">
              Rides in selected period
            </h2>

            {filteredRides.length === 0 ? (
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
                      {filteredRides.map((r) => {
                        const { datePart, timePart } = formatLocalDateTime(
                          r.departureTime
                        );
                        const dollars = (r.totalPriceCents / 100).toFixed(2);

                        return (
                          <tr
                            key={r.id}
                            className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer"
                            onClick={() =>
                              router.push(`/driver/rides/${r.id}`)
                            }
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
                              {r.originCity} → {r.destinationCity}
                            </td>
                            <td className="px-4 py-2 align-middle text-right text-slate-700">
                              {r.distanceMiles.toFixed(1)}
                            </td>
                            <td className="px-4 py-2 align-middle text-right text-slate-900">
                              ${dollars}
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
