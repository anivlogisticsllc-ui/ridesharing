// app/admin/rides/page.tsx
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
  driver: { id: string; name: string | null; email: string | null; publicId: string | null } | null;

  latestBooking:
    | (Record<string, any> & {
        id: string;
        status: string;
        paymentType: string | null;
      })
    | null;
};

type ApiResponse = { ok: true; rides: RideRow[] } | { ok: false; error: string };

function money(cents: number | null) {
  if (typeof cents !== "number") return "-";
  return `$${(cents / 100).toFixed(2)}`;
}

function dt(s: string | null) {
  if (!s) return "-";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
}

type Role = "RIDER" | "DRIVER" | "ADMIN";
function asRole(v: unknown): Role | null {
  return v === "RIDER" || v === "DRIVER" || v === "ADMIN" ? v : null;
}

function normalize(s: unknown) {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

export default function AdminRidesPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const role = asRole((session?.user as any)?.role);

  const [rides, setRides] = useState<RideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");

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

    // exact match first
    const exact = rides.find((r) => normalize(r.id) === needle);
    if (exact) return exact.id;

    // unique prefix match (helps paste first ~10 chars)
    const prefixMatches = rides.filter((r) => normalize(r.id).startsWith(needle));
    if (prefixMatches.length === 1) return prefixMatches[0].id;

    return null;
  }, [rides, needle]);

  const filtered = useMemo(() => {
    if (!needle) {
      // default sort: newest updated first
      return [...rides].sort((a, b) => (Date.parse(b.updatedAt ?? "") || 0) - (Date.parse(a.updatedAt ?? "") || 0));
    }

    function score(r: RideRow) {
      const id = normalize(r.id);

      if (id === needle) return 1000;
      if (id.startsWith(needle)) return 800;
      if (id.includes(needle)) return 500;

      const otherHay = [
        r.status,
        r.originCity,
        r.destinationCity,
        r.rider?.email ?? "",
        r.rider?.name ?? "",
        r.driver?.email ?? "",
        r.driver?.name ?? "",
        r.latestBooking?.paymentType ?? "",
      ]
        .join(" ")
        .toLowerCase();

      if (otherHay.includes(needle)) return 200;

      return 0;
    }

    const withScore = rides
      .map((r) => ({ r, s: score(r) }))
      .filter((x) => x.s > 0);

    withScore.sort((a, b) => {
      if (b.s !== a.s) return b.s - a.s;
      const bu = Date.parse(b.r.updatedAt ?? "") || 0;
      const au = Date.parse(a.r.updatedAt ?? "") || 0;
      return bu - au;
    });

    return withScore.map((x) => x.r);
  }, [rides, needle]);

  function onJump() {
    if (!jumpTarget) return;
    router.push(`/admin/rides/${encodeURIComponent(jumpTarget)}`);
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-10">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Rides</h1>
            <p className="mt-1 text-sm text-slate-600">All rides with timestamps and latest booking.</p>
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

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onJump();
            }}
            placeholder="Search ride id (exact/prefix), city, status, rider/driver email, payment type…"
            className="w-full max-w-xl rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
          />

          <button
            type="button"
            onClick={onJump}
            disabled={!jumpTarget}
            className={`rounded-xl px-3 py-2 text-sm font-medium ${
              jumpTarget
                ? "border border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
                : "border border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
            }`}
            title={jumpTarget ? `Open ${jumpTarget}` : "Type a full ride id or unique prefix"}
          >
            Open
          </button>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Loading…</p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700 shadow-sm">
            <p className="text-sm font-medium">{error}</p>
          </div>
        ) : (
          <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-[1100px] w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="p-3">Ride</th>
                  <th className="p-3">Route</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Payment</th>
                  <th className="p-3">Fare</th>
                  <th className="p-3">Rider</th>
                  <th className="p-3">Driver</th>
                  <th className="p-3">Departure</th>
                  <th className="p-3">Started</th>
                  <th className="p-3">Completed</th>
                  <th className="p-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="p-3">
                      <Link className="underline" href={`/admin/rides/${encodeURIComponent(r.id)}`}>
                        {r.id.slice(0, 10)}…
                      </Link>
                    </td>
                    <td className="p-3">
                      {r.originCity} → {r.destinationCity}
                    </td>
                    <td className="p-3">{r.status}</td>
                    <td className="p-3">{r.latestBooking?.paymentType ?? "-"}</td>
                    <td className="p-3">{money(r.totalPriceCents)}</td>
                    <td className="p-3">{r.rider?.email ?? r.rider?.name ?? "-"}</td>
                    <td className="p-3">{r.driver?.email ?? r.driver?.name ?? "-"}</td>
                    <td className="p-3">{dt(r.departureTime)}</td>
                    <td className="p-3">{dt(r.tripStartedAt)}</td>
                    <td className="p-3">{dt(r.tripCompletedAt)}</td>
                    <td className="p-3">{dt(r.updatedAt)}</td>
                  </tr>
                ))}

                {filtered.length === 0 ? (
                  <tr>
                    <td className="p-4 text-slate-500" colSpan={11}>
                      No rides match your search.
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