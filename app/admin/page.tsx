// app/admin/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {hint ? <div className="mt-2 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function TabLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
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

      // Hard auth failures: bounce to login (keeps behavior consistent)
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
      setError("Failed to load metrics.");
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }

  // Gate: must be authenticated + ADMIN
  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace(`/auth/login?callbackUrl=${callbackUrl}`);
      return;
    }

    if (role !== "ADMIN") {
      // Don’t auto-redirect silently; show Forbidden so it’s obvious what’s happening
      setLoading(false);
      setMetrics(null);
      setError("Forbidden");
      return;
    }

    load();
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

  // Loading screen while NextAuth is figuring out session
  if (status === "loading") {
    return (
      <main className="p-8 text-sm text-slate-600">
        Loading…
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Admin</h1>
            <p className="mt-1 text-sm text-slate-600">
              Basic dashboard + user management.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <TabLink href="/admin/users">Users</TabLink>
            <TabLink href="/admin/riders">Riders</TabLink>
            <TabLink href="/admin/metrics">Metrics</TabLink>

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

            {error === "Forbidden" ? (
              <p className="mt-3 text-xs text-rose-700/90">
                If you expected admin access, your session role or the /api/admin/* routes are still
                gating you as non-admin. Fix the API guards to check <code>role === "ADMIN"</code>.
              </p>
            ) : null}
          </div>
        ) : metrics ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {cards.map((c) => (
                <StatCard key={c.label} label={c.label} value={c.value} />
              ))}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Quick links</h2>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
                <li>
                  <Link className="underline" href="/admin/users">
                    Manage users
                  </Link>
                </li>
                <li>
                  <Link className="underline" href="/admin/riders">
                    View riders
                  </Link>
                </li>
                <li>
                  <Link className="underline" href="/admin/metrics">
                    View metrics
                  </Link>
                </li>
              </ul>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
