"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type RideRow = {
  id: string;
  status: string;

  originCity: string;
  destinationCity: string;
  departureTime: string | null;

  tripStartedAt: string | null;
  tripCompletedAt: string | null;

  distanceMiles: number | null;
  passengerCount: number | null;
  totalPriceCents: number | null;

  createdAt: string | null;
  updatedAt: string | null;

  rider: { id: string; name: string | null; email: string | null } | null;
  driver: {
    id: string;
    name: string | null;
    email: string | null;
    publicId: string | null;
  } | null;

  latestBooking:
    | (Record<string, any> & {
        id: string;
        status: string;
        paymentType: string | null;
      })
    | null;
};

type ApiResponse = { ok: true; rides: RideRow[] } | { ok: false; error: string };

type Role = "RIDER" | "DRIVER" | "ADMIN";

type StatusFilter =
  | "ALL"
  | "REQUESTED"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

type PaymentFilter = "ALL" | "CARD" | "CASH" | "UNKNOWN";
type DateFilter = "ALL" | "TODAY" | "YESTERDAY" | "LAST_7_DAYS" | "THIS_MONTH";

function asRole(v: unknown): Role | null {
  return v === "RIDER" || v === "DRIVER" || v === "ADMIN" ? v : null;
}

function normalize(s: unknown) {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

function money(cents: number | null) {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "-";
  return `$${(cents / 100).toFixed(2)}`;
}

function dt(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function shortDateTime(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toDayStart(date: Date) {
  const x = new Date(date);
  x.setHours(0, 0, 0, 0);
  return x;
}

function matchesDateFilter(value: string | null, filter: DateFilter) {
  if (filter === "ALL") return true;
  if (!value) return false;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;

  const now = new Date();
  const todayStart = toDayStart(now);

  if (filter === "TODAY") {
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    return d >= todayStart && d < tomorrowStart;
  }

  if (filter === "YESTERDAY") {
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    return d >= yesterdayStart && d < todayStart;
  }

  if (filter === "LAST_7_DAYS") {
    const start = new Date(todayStart);
    start.setDate(start.getDate() - 6);
    return d >= start;
  }

  if (filter === "THIS_MONTH") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return d >= start;
  }

  return true;
}

function statusTone(status: string) {
  const s = String(status || "").toUpperCase();

  if (s === "COMPLETED") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (s === "CANCELLED" || s === "FAILED") return "bg-rose-50 text-rose-700 ring-rose-200";
  if (s === "ACCEPTED" || s === "IN_PROGRESS") return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-slate-50 text-slate-700 ring-slate-200";
}

function paymentTone(paymentType: string | null) {
  const p = String(paymentType || "").toUpperCase();
  if (p === "CARD") return "bg-indigo-50 text-indigo-700 ring-indigo-200";
  if (p === "CASH") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  return "bg-slate-50 text-slate-700 ring-slate-200";
}

function pill(text: string, className: string) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${className}`}
    >
      {text}
    </span>
  );
}

export default function AdminRidesPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const role = asRole((session?.user as any)?.role);

  const [rides, setRides] = useState<RideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("ALL");
  const [dateFilter, setDateFilter] = useState<DateFilter>("LAST_7_DAYS");

  async function load() {
    try {
      setError(null);
      setLoading(true);

      const res = await fetch("/api/admin/rides", { cache: "no-store" });
      if (res.status === 401) {
        router.replace(`/auth/login?callbackUrl=${encodeURIComponent("/admin/rides")}`);
        return;
      }

      const data = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !data || !("ok" in data) || !data.ok) {
        setRides([]);
        setError((data as any)?.error || `Failed (HTTP ${res.status})`);
        return;
      }

      setRides(data.rides || []);
    } catch (e) {
      console.error(e);
      setError("Failed to load rides.");
      setRides([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace(`/auth/login?callbackUrl=${encodeURIComponent("/admin/rides")}`);
      return;
    }

    if (role !== "ADMIN") {
      setError("Forbidden");
      setLoading(false);
      return;
    }

    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session, role]);

  const needle = useMemo(() => normalize(q), [q]);

  const jumpTarget = useMemo(() => {
    if (!needle) return null;

    const exact = rides.find((r) => normalize(r.id) === needle);
    if (exact) return exact.id;

    const prefixMatches = rides.filter((r) => normalize(r.id).startsWith(needle));
    if (prefixMatches.length === 1) return prefixMatches[0].id;

    return null;
  }, [rides, needle]);

  const filtered = useMemo(() => {
    const result = rides.filter((r) => {
      const rideStatus = String(r.status || "").toUpperCase();
      const paymentType = String(r.latestBooking?.paymentType || "UNKNOWN").toUpperCase();

      if (statusFilter !== "ALL" && rideStatus !== statusFilter) return false;
      if (paymentFilter !== "ALL" && paymentType !== paymentFilter) return false;

      const requestedAt = r.createdAt || r.departureTime;
      if (!matchesDateFilter(requestedAt, dateFilter)) return false;

      if (!needle) return true;

      const hay = [
        r.id,
        r.status,
        r.originCity,
        r.destinationCity,
        r.rider?.email ?? "",
        r.rider?.name ?? "",
        r.driver?.email ?? "",
        r.driver?.name ?? "",
        r.driver?.publicId ?? "",
        r.latestBooking?.paymentType ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return hay.includes(needle);
    });

    result.sort((a, b) => {
      const aTime =
        Date.parse(a.tripCompletedAt ?? "") ||
        Date.parse(a.tripStartedAt ?? "") ||
        Date.parse(a.createdAt ?? "") ||
        0;

      const bTime =
        Date.parse(b.tripCompletedAt ?? "") ||
        Date.parse(b.tripStartedAt ?? "") ||
        Date.parse(b.createdAt ?? "") ||
        0;

      return bTime - aTime;
    });

    return result;
  }, [rides, needle, statusFilter, paymentFilter, dateFilter]);

  function onJump() {
    if (!jumpTarget) return;
    router.push(`/admin/rides/${encodeURIComponent(jumpTarget)}`);
  }

  function resetFilters() {
    setQ("");
    setStatusFilter("ALL");
    setPaymentFilter("ALL");
    setDateFilter("LAST_7_DAYS");
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-10">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Rides</h1>
            <p className="mt-1 text-sm text-slate-600">
              All rides with latest booking, payment type, and ride timestamps.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin"
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Back
            </Link>

            <button
              type="button"
              onClick={load}
              className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Refresh
            </button>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[minmax(280px,1.8fr)_160px_160px_160px_auto_auto]">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Search
              </label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onJump();
                }}
                placeholder="Ride id, city, status, rider/driver email, payment..."
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              >
                <option value="ALL">All</option>
                <option value="REQUESTED">Requested</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Payment
              </label>
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              >
                <option value="ALL">All</option>
                <option value="CARD">Card</option>
                <option value="CASH">Cash</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Requested
              </label>
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              >
                <option value="ALL">All time</option>
                <option value="TODAY">Today</option>
                <option value="YESTERDAY">Yesterday</option>
                <option value="LAST_7_DAYS">Last 7 days</option>
                <option value="THIS_MONTH">This month</option>
              </select>
            </div>

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={onJump}
                disabled={!jumpTarget}
                className={`rounded-xl px-3 py-2 text-sm font-medium ${
                  jumpTarget
                    ? "border border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
                    : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                }`}
                title={jumpTarget ? `Open ${jumpTarget}` : "Type full id or unique prefix"}
              >
                Open
              </button>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Reset
              </button>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Loading…</p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700 shadow-sm">
            <p className="text-sm font-medium">{error}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr className="text-slate-700">
                  <th className="w-[96px] p-3">Ride</th>
                  <th className="w-[24%] p-3">Route</th>
                  <th className="w-[96px] p-3">Status</th>
                  <th className="w-[90px] p-3">Payment</th>
                  <th className="w-[80px] p-3">Fare</th>
                  <th className="w-[18%] p-3">Rider</th>
                  <th className="w-[18%] p-3">Driver</th>
                  <th className="w-[132px] p-3">Requested</th>
                  <th className="w-[132px] p-3">Started</th>
                  <th className="w-[132px] p-3">Completed</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((r) => {
                  const paymentType = String(r.latestBooking?.paymentType || "UNKNOWN").toUpperCase();

                  return (
                    <tr key={r.id} className="border-b border-slate-100 align-top">
                      <td className="p-3">
                        <Link
                          className="font-medium text-slate-900 underline"
                          href={`/admin/rides/${encodeURIComponent(r.id)}`}
                        >
                          {r.id.slice(0, 10)}…
                        </Link>
                      </td>

                      <td className="p-3">
                        <div className="whitespace-normal break-words text-slate-800">
                          {r.originCity} → {r.destinationCity}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {r.distanceMiles != null ? `${r.distanceMiles.toFixed(1)} mi` : "-"}
                          {r.passengerCount != null ? ` • ${r.passengerCount} pax` : ""}
                        </div>
                      </td>

                      <td className="p-3">
                        {pill(String(r.status || "-"), statusTone(r.status))}
                      </td>

                      <td className="p-3">
                        {pill(paymentType, paymentTone(paymentType))}
                      </td>

                      <td className="p-3 font-medium text-slate-900">
                        {money(r.totalPriceCents)}
                      </td>

                      <td className="p-3">
                        <div className="whitespace-normal break-words text-slate-800">
                          {r.rider?.email ?? r.rider?.name ?? "-"}
                        </div>
                      </td>

                      <td className="p-3">
                        <div className="whitespace-normal break-words text-slate-800">
                          {r.driver?.email ?? r.driver?.name ?? "-"}
                        </div>
                        {r.driver?.publicId ? (
                          <div className="mt-1 text-xs text-slate-500">
                            {r.driver.publicId}
                          </div>
                        ) : null}
                      </td>

                      <td className="p-3 text-slate-700">
                        {shortDateTime(r.createdAt || r.departureTime)}
                      </td>

                      <td className="p-3 text-slate-700">
                        {shortDateTime(r.tripStartedAt)}
                      </td>

                      <td className="p-3 text-slate-700">
                        {shortDateTime(r.tripCompletedAt)}
                      </td>
                    </tr>
                  );
                })}

                {filtered.length === 0 ? (
                  <tr>
                    <td className="p-4 text-slate-500" colSpan={10}>
                      No rides match the current filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}