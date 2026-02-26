// app/admin/drivers/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type DriverRow = {
  id: string;
  email: string;
  name: string | null;
  role: "DRIVER";
  isAdmin: boolean;
  accountStatus: string | null;
  createdAt: string;
  updatedAt: string;
  publicId: string | null;
  onboardingCompleted: boolean;
  membershipActive: boolean;
  membershipPlan: string | null;
  trialEndsAt: string | null;
};

type ApiOk = { ok: true; drivers: DriverRow[] };
type ApiErr = { ok: false; error: string; detail?: string };
type ApiResponse = ApiOk | ApiErr;

function inputClass() {
  return "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
}

function fmt(v: any) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
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

export default function AdminDriversPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const callbackUrl = useMemo(() => encodeURIComponent("/admin/drivers"), []);

  const [q, setQ] = useState("");
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(opts?: { spinner?: boolean }) {
    const spinner = opts?.spinner ?? true;

    try {
      setError(null);
      if (spinner) setLoading(true);
      else setRefreshing(true);

      const url =
        q.trim().length > 0
          ? `/api/admin/drivers?q=${encodeURIComponent(q.trim())}`
          : `/api/admin/drivers`;

      const res = await fetch(url, { cache: "no-store" });

      if (res.status === 401) {
        router.replace(`/auth/login?callbackUrl=${callbackUrl}`);
        return;
      }

      if (res.status === 403) {
        setDrivers([]);
        setError("Forbidden");
        return;
      }

      if (!res.ok) {
        setDrivers([]);
        setError(await readApiError(res));
        return;
      }

      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!json || !("ok" in json) || !json.ok) {
        setDrivers([]);
        setError((json as any)?.error || "Failed to load drivers.");
        return;
      }

      setDrivers(json.drivers);
    } catch (e) {
      console.error(e);
      setDrivers([]);
      setError("Failed to load drivers.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace(`/auth/login?callbackUrl=${callbackUrl}`);
      return;
    }

    // API will enforce admin; page can just load.
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session]);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold text-slate-900">Drivers</h1>
            <p className="mt-1 text-sm text-slate-600">Drivers list (role DRIVER).</p>
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
              onClick={() => load({ spinner: false })}
              disabled={loading || refreshing}
              className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700 shadow-sm">
            <p className="text-sm font-medium">{error}</p>
          </div>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[260px] flex-1">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Search
              </div>
              <input
                className={inputClass()}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search email, name, publicId…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") load({ spinner: false });
                }}
              />
            </div>

            <button
              type="button"
              onClick={() => load({ spinner: false })}
              disabled={loading || refreshing}
              className="h-[38px] rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            >
              Apply
            </button>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[1.6fr_0.6fr_0.7fr_0.9fr_0.8fr] gap-3 border-b border-slate-200 px-4 py-3 text-xs font-semibold text-slate-600">
            <div>Driver</div>
            <div>Role</div>
            <div>Admin</div>
            <div>Onboarding</div>
            <div>Created</div>
          </div>

          {loading ? (
            <div className="px-4 py-6 text-sm text-slate-600">Loading…</div>
          ) : drivers.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-600">No drivers found.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {drivers.map((u) => (
                <div
                  key={u.id}
                  className="grid grid-cols-[1.6fr_0.6fr_0.7fr_0.9fr_0.8fr] gap-3 px-4 py-4"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{u.name || "—"}</div>
                    <div className="text-sm text-slate-600 break-words">{u.email}</div>
                    <div className="text-xs text-slate-500">publicId: {fmt(u.publicId)}</div>

                    <div className="mt-2">
                      <Link
                        href={`/admin/users/${encodeURIComponent(u.id)}`}
                        className="text-sm font-medium text-slate-900 underline"
                      >
                        View
                      </Link>
                    </div>
                  </div>

                  <div className="text-sm text-slate-800">{u.role}</div>

                  <div className="text-sm text-slate-800">{u.isAdmin ? "Yes" : "No"}</div>

                  <div className="text-sm text-slate-800">
                    {u.onboardingCompleted ? "Completed" : "Not completed"}
                  </div>

                  <div className="text-sm text-slate-800">{fmt(u.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
