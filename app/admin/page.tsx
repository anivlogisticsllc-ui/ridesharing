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

function TabLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}

async function readApiError(res: Response) {
  const text = await res.text().catch(() => "");
  if (!text) return `Request failed (HTTP ${res.status}).`;
  try {
    const json = JSON.parse(text);
    return json?.error || json?.message || `Request failed (HTTP ${res.status}).`;
  } catch {
    return text.slice(0, 300) || `Request failed (HTTP ${res.status}).`;
  }
}

type ExtendType = "RIDER" | "DRIVER";

export default function AdminDashboardPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const role = asRole((session?.user as any)?.role);

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const callbackUrl = useMemo(() => encodeURIComponent("/admin"), []);

  // --- Membership extend UI state ---
  const [targetEmail, setTargetEmail] = useState("");
  const [extendDays, setExtendDays] = useState(30);
  const [extendType, setExtendType] = useState<ExtendType>("DRIVER");
  const [extendBusy, setExtendBusy] = useState(false);
  const [extendMsg, setExtendMsg] = useState<string | null>(null);

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
      setError("Failed to load metrics.");
      setMetrics(null);
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

  async function handleExtendMembership() {
    const email = targetEmail.trim().toLowerCase();

    if (!email || !email.includes("@")) {
      setExtendMsg("Enter a valid email address first.");
      return;
    }

    const days = Number(extendDays);
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      setExtendMsg("Days must be between 1 and 3650.");
      return;
    }

    setExtendBusy(true);
    setExtendMsg(null);

    try {
      // Keep YOUR endpoint path (you said B is complete)
      const res = await fetch("/api/admin/membership/extend-membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, days, type: extendType }),
      });

      if (!res.ok) throw new Error(await readApiError(res));

      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || "Failed to extend membership.");

      // Support both payload styles (in case your route returns `updated` array or single newExpiry)
      const updated = json?.updated as Array<{ type: string; expiryDate: string }> | undefined;
      const newExpiry = json?.newExpiry as string | undefined;

      const detail =
        updated?.length
          ? updated
              .map((u) => `${u.type} → ${new Date(u.expiryDate).toLocaleString()}`)
              .join(" | ")
          : newExpiry
          ? `${extendType} → ${new Date(newExpiry).toLocaleString()}`
          : "Updated.";

      setExtendMsg(`Done. ${detail}`);
    } catch (e: any) {
      setExtendMsg(e?.message || "Failed to extend membership.");
    } finally {
      setExtendBusy(false);
    }
  }

  if (status === "loading") {
    return <main className="p-8 text-sm text-slate-600">Loading…</main>;
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Admin</h1>
            <p className="mt-1 text-sm text-slate-600">Basic dashboard + user management.</p>
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

        {/* Membership tools */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Membership tools</h2>
          <p className="mt-1 text-xs text-slate-500">
            Extends free access by updating <span className="font-medium">Membership.expiryDate</span>.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-6">
            <div className="md:col-span-3">
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Target email
              </label>
              <input
                value={targetEmail}
                onChange={(e) => setTargetEmail(e.target.value)}
                placeholder="user@example.com"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="md:col-span-1">
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Days
              </label>
              <input
                type="number"
                min={1}
                max={3650}
                value={extendDays}
                onChange={(e) => setExtendDays(Number(e.target.value || 30))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Type
              </label>
              <select
                value={extendType}
                onChange={(e) => setExtendType(e.target.value as ExtendType)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="DRIVER">DRIVER</option>
                <option value="RIDER">RIDER</option>
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExtendMembership}
              disabled={extendBusy}
              className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {extendBusy ? "Extending…" : "Extend membership"}
            </button>

            {extendMsg ? <p className="text-sm text-slate-700">{extendMsg}</p> : null}
          </div>
        </section>

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
