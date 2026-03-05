// app/admin/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Metrics = {
  openRides: number;
  acceptedRides: number;
  inRouteRides: number;
  completedToday: number;
  cancelledToday: number;
  usersTotal: number;
  driversTotal: number;
};

type MetricsResponse =
  | { ok: true; metrics: Metrics }
  | { ok: false; error: string };

type Role = "RIDER" | "DRIVER" | "ADMIN";

function asRole(v: unknown): Role | null {
  return v === "RIDER" || v === "DRIVER" || v === "ADMIN" ? v : null;
}

function StatCard(props: { label: string; value: number | string; hint?: string }) {
  const { label, value, hint } = props;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {hint ? <div className="mt-2 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function TabLink(props: { href: string; children: ReactNode }) {
  const { href, children } = props;
  return (
    <Link
      href={href}
      className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const role = asRole((session?.user as any)?.role);

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const callbackUrl = useMemo(() => encodeURIComponent("/admin"), []);

  async function load() {
    try {
      setError(null);
      setLoading(true);

      const res = await fetch("/api/admin/metrics", { cache: "no-store" });

      if (res.status === 401) {
        router.replace(`/auth/login?callbackUrl=${callbackUrl}`);
        return;
      }

      const data = (await res.json().catch(() => null)) as MetricsResponse | null;

      if (res.status === 403) {
        setMetrics(null);
        setError("Forbidden");
        return;
      }

      if (!res.ok || !data || !("ok" in data) || !data.ok) {
        setMetrics(null);
        setError((data as any)?.error || `Failed to load metrics (HTTP ${res.status})`);
        return;
      }

      setMetrics(data.metrics);
    } catch (e) {
      console.error(e);
      setMetrics(null);
      setError("Failed to load metrics.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace(`/auth/login?callbackUrl=${callbackUrl}`);
      return;
    }

    if (role !== "ADMIN") {
      setLoading(false);
      setMetrics(null);
      setError("Forbidden");
      return;
    }

    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session, role, router, callbackUrl]);

  const cards = useMemo(() => {
    if (!metrics) return [];
    return [
      { label: "Open rides", value: metrics.openRides },
      { label: "Accepted rides", value: metrics.acceptedRides },
      { label: "In route", value: metrics.inRouteRides },
      { label: "Completed today", value: metrics.completedToday },
      { label: "Cancelled today", value: metrics.cancelledToday },
      { label: "Users total", value: metrics.usersTotal },
      { label: "Drivers total", value: metrics.driversTotal },
    ];
  }, [metrics]);

  if (status === "loading") {
    return <main className="p-8 text-sm text-slate-600">Loading…</main>;
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Admin</h1>
            <p className="mt-1 text-sm text-slate-600">Dashboard + links to admin tools.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <TabLink href="/admin/users">Users</TabLink>
            <TabLink href="/admin/drivers">Drivers</TabLink>
            <TabLink href="/admin/riders">Riders</TabLink>
            <TabLink href="/admin/metrics">Metrics</TabLink>
            <TabLink href="/admin/rides">Rides</TabLink>

            <button
              type="button"
              onClick={load}
              className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Refresh
            </button>
          </div>
        </header>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Loading…</p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700 shadow-sm">
            <p className="text-sm font-medium">{error}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              {error !== "Forbidden" ? (
                <button
                  type="button"
                  onClick={load}
                  className="rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                >
                  Retry
                </button>
              ) : null}

              <Link
                href="/"
                className="rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
              >
                Back home
              </Link>
            </div>
          </div>
        ) : metrics ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {cards.map((c) => (
                <StatCard key={c.label} label={c.label} value={c.value} />
              ))}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Next actions</h2>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
                <li>
                  Go to{" "}
                  <Link className="underline" href="/admin/users">
                    Users
                  </Link>{" "}
                  to manage role/status/admin grants and view full user details.
                </li>
                <li>
                  Go to{" "}
                  <Link className="underline" href="/admin/drivers">
                    Drivers
                  </Link>{" "}
                  or{" "}
                  <Link className="underline" href="/admin/riders">
                    Riders
                  </Link>{" "}
                  for role-specific lists.
                </li>
                <li>
                  Go to{" "}
                  <Link className="underline" href="/admin/rides">
                    Rides
                  </Link>{" "}
                  to search and inspect ride history.
                </li>
              </ul>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}