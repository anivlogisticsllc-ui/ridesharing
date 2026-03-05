// app/admin/users/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Role = "RIDER" | "DRIVER" | "ADMIN";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  accountStatus: string | null;
  isAdmin: boolean;
  membershipActive: boolean;
  membershipPlan: string | null;
  trialEndsAt: string | null;
  freeMembershipEndsAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  publicId: string | null;
  onboardingCompleted: boolean;
  driverProfile?: {
    verificationStatus?: string | null;
    plateNumber?: string | null;
    plateState?: string | null;
    vehicleMake?: string | null;
    vehicleModel?: string | null;
    vehicleYear?: number | null;
    vehicleColor?: string | null;
  } | null;
};

type ListResponse = { ok: true; users: UserRow[] } | { ok: false; error: string };

function asRole(v: unknown): Role | null {
  return v === "RIDER" || v === "DRIVER" || v === "ADMIN" ? v : null;
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

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function vehicleSummary(p?: UserRow["driverProfile"]) {
  if (!p) return "—";
  const bits = [
    p.vehicleYear ? String(p.vehicleYear) : null,
    p.vehicleMake || null,
    p.vehicleModel || null,
    p.vehicleColor || null,
  ].filter(Boolean);

  const plate = [p.plateState || null, p.plateNumber || null].filter(Boolean).join(" ");

  const left = bits.length ? bits.join(" ") : "";
  if (left && plate) return `${left} · ${plate}`;
  return left || plate || "—";
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const role = asRole((session?.user as any)?.role);

  const callbackUrl = useMemo(() => encodeURIComponent("/admin/users"), []);

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "ALL">("ALL");
  const [users, setUsers] = useState<UserRow[]>([]);

  // Details drawer (kept, but currently unused since View is a Link)
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsUserId, setDetailsUserId] = useState<string | null>(null);
  const [details, setDetails] = useState<any>(null);

  // per-row grant input state
  const [grantDaysById, setGrantDaysById] = useState<Record<string, string>>({});

  function setGrantDays(userId: string, v: string) {
    setGrantDaysById((prev) => ({ ...prev, [userId]: v }));
  }

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (roleFilter !== "ALL") params.set("role", roleFilter);

      const qs = params.toString();
      const url = qs ? `/api/admin/users?${qs}` : "/api/admin/users";

      const res = await fetch(url, { cache: "no-store" });

      if (res.status === 401) {
        router.replace(`/auth/login?callbackUrl=${callbackUrl}`);
        return;
      }

      if (res.status === 403) {
        setUsers([]);
        setError("Forbidden");
        return;
      }

      const json = (await res.json().catch(() => null)) as ListResponse | null;
      if (!res.ok || !json || !("ok" in json) || !json.ok) {
        setUsers([]);
        setError((json as any)?.error || `Failed to load users (HTTP ${res.status})`);
        return;
      }

      setUsers(json.users || []);
    } catch (e) {
      console.error(e);
      setUsers([]);
      setError("Failed to load users.");
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
      setUsers([]);
      setError("Forbidden");
      return;
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session, role, callbackUrl]);

  async function patchUser(userId: string, body: any) {
    setBusyId(userId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...body }),
      });

      if (!res.ok) throw new Error(await readApiError(res));
      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || "Update failed.");

      const updated = json.user as UserRow;
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      return updated;
    } finally {
      setBusyId(null);
    }
  }

  // (kept for future when you switch View back to a drawer)
  async function openDetails(userId: string) {
    setDetailsOpen(true);
    setDetailsUserId(userId);
    setDetails(null);
    setDetailsError(null);
    setDetailsLoading(true);

    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await readApiError(res));

      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || "Failed to load details.");

      setDetails(json.user);
    } catch (e: any) {
      setDetailsError(e?.message || "Failed to load details.");
    } finally {
      setDetailsLoading(false);
    }
  }

  async function applyGrant(user: UserRow) {
    const raw = (grantDaysById[user.id] || "").trim();
    const days = Number(raw);

    if (!raw) return;
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      alert("Grant days must be between 1 and 3650.");
      return;
    }

    await patchUser(user.id, { grantDays: days });
    setGrantDays(user.id, "");
  }

  async function clearGrant(user: UserRow) {
    await patchUser(user.id, { freeMembershipEndsAt: null });
  }

  if (status === "loading") {
    return <main className="p-8 text-sm text-slate-600">Loading…</main>;
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 overflow-x-hidden">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-10 min-w-0">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold text-slate-900">Admin users</h1>
            <p className="mt-1 text-sm text-slate-600">
              Search + edit role/status/admin grants and view full user details.
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
          <div className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-8">
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Search
              </label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search email, name, publicId…"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Role
              </label>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as any)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="ALL">All roles</option>
                <option value="RIDER">RIDER</option>
                <option value="DRIVER">DRIVER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </div>

            <div className="md:col-span-1 flex items-end">
              <button
                type="button"
                onClick={load}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Apply
              </button>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700 shadow-sm">
            <p className="text-sm font-medium">{error}</p>
          </div>
        ) : null}

        {/* ✅ Remove horizontal scrollbar: no overflow-x-auto, no fixed widths, allow wrapping */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="w-full min-w-0 overflow-x-hidden">
            <table className="w-full table-auto">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr className="[&>th]:text-left">
                  <th className="px-4 py-3 whitespace-normal break-words">User</th>
                  <th className="px-4 py-3 whitespace-normal break-words">Role</th>
                  <th className="px-4 py-3 whitespace-normal break-words">Status</th>
                  <th className="px-4 py-3 whitespace-normal break-words">Admin</th>
                  <th className="px-4 py-3 whitespace-normal break-words">Membership</th>
                  <th className="px-4 py-3 whitespace-normal break-words">Admin grant</th>
                  <th className="px-4 py-3 whitespace-normal break-words">Driver vehicle</th>
                  <th className="px-4 py-3 whitespace-normal break-words">Created</th>
                  <th className="px-4 py-3 whitespace-normal break-words">Updated</th>
                  <th className="px-4 py-3 whitespace-normal break-words">Details</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td className="px-4 py-6 text-slate-500" colSpan={10}>
                      Loading…
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-slate-500" colSpan={10}>
                      No users found.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => {
                    const rowBusy = busyId === u.id;

                    return (
                      <tr key={u.id} className="align-top">
                        <td className="px-4 py-3 min-w-0 whitespace-normal break-words">
                          <div className="font-medium text-slate-900 truncate">{u.name || "—"}</div>
                          <div className="text-xs text-slate-600 break-words">{u.email}</div>
                          <div className="text-xs text-slate-500 break-words">
                            publicId: {u.publicId || "—"}
                          </div>
                        </td>

                        <td className="px-4 py-3 whitespace-normal break-words">
                          <select
                            value={u.role}
                            disabled={rowBusy}
                            onChange={async (e) => {
                              const newRole = e.target.value as Role;
                              await patchUser(u.id, { role: newRole });
                            }}
                            className="w-full max-w-[7rem] rounded-lg border border-slate-300 px-2 py-1 text-sm"
                          >
                            <option value="RIDER">RIDER</option>
                            <option value="DRIVER">DRIVER</option>
                            <option value="ADMIN">ADMIN</option>
                          </select>
                        </td>

                        <td className="px-4 py-3 whitespace-normal break-words">
                          <select
                            value={u.accountStatus || "ACTIVE"}
                            disabled={rowBusy}
                            onChange={async (e) => {
                              await patchUser(u.id, { accountStatus: e.target.value });
                            }}
                            className="w-full max-w-[8rem] rounded-lg border border-slate-300 px-2 py-1 text-sm"
                          >
                            <option value="ACTIVE">ACTIVE</option>
                            <option value="SUSPENDED">SUSPENDED</option>
                            <option value="DISABLED">DISABLED</option>
                          </select>
                        </td>

                        <td className="px-4 py-3 whitespace-normal break-words">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={!!u.isAdmin}
                              disabled={rowBusy}
                              onChange={async (e) => {
                                await patchUser(u.id, { isAdmin: e.target.checked });
                              }}
                            />
                            <span className="text-sm">isAdmin</span>
                          </label>
                        </td>

                        <td className="px-4 py-3 whitespace-normal break-words">
                          <div className="text-sm text-slate-900">
                            {u.membershipActive ? "Active" : "Inactive"}
                          </div>
                          <div className="text-xs text-slate-600">Plan: {u.membershipPlan || "—"}</div>
                          <div className="text-xs text-slate-500">Trial: {fmtDate(u.trialEndsAt)}</div>
                        </td>

                        <td className="px-4 py-3 whitespace-normal break-words">
                          <div className="text-xs text-slate-600">Current: {fmtDate(u.freeMembershipEndsAt)}</div>

                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <input
                              value={grantDaysById[u.id] || ""}
                              onChange={(e) => setGrantDays(u.id, e.target.value)}
                              placeholder="Days"
                              disabled={rowBusy}
                              inputMode="numeric"
                              className="w-full max-w-[5rem] rounded-lg border border-slate-300 px-2 py-1 text-sm"
                            />
                            <button
                              type="button"
                              disabled={rowBusy || !(grantDaysById[u.id] || "").trim()}
                              onClick={() => applyGrant(u)}
                              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                            >
                              Apply
                            </button>
                            <button
                              type="button"
                              disabled={rowBusy}
                              onClick={() => clearGrant(u)}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                            >
                              Clear
                            </button>
                          </div>
                        </td>

                        <td className="px-4 py-3 whitespace-normal break-words">
                          <div className="text-sm text-slate-900 break-words">
                            {vehicleSummary(u.driverProfile || undefined)}
                          </div>
                          <div className="text-xs text-slate-500">
                            Verify: {u.driverProfile?.verificationStatus || "—"}
                          </div>
                        </td>

                        <td className="px-4 py-3 text-xs text-slate-600 whitespace-normal break-words">
                          {fmtDate(u.createdAt)}
                        </td>

                        <td className="px-4 py-3 text-xs text-slate-600 whitespace-normal break-words">
                          {fmtDate(u.updatedAt)}
                        </td>

                        <td className="px-4 py-3 whitespace-normal break-words">
                          <Link
                            href={`/admin/users/${encodeURIComponent(u.id)}`}
                            className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                          >
                            View
                          </Link>

                          {/* If you ever want the drawer again:
                              <button onClick={() => openDetails(u.id)}>View</button>
                          */}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Details drawer (currently unused) */}
        {detailsOpen ? (
          <div className="fixed inset-0 z-50 flex">
            <button
              type="button"
              className="absolute inset-0 bg-black/30"
              onClick={() => setDetailsOpen(false)}
              aria-label="Close"
            />
            <div className="relative ml-auto h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900">User details</h2>
                  <p className="text-xs text-slate-500 break-words">UserId: {detailsUserId}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailsOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>

              <div className="mt-4">
                {detailsLoading ? (
                  <p className="text-sm text-slate-500">Loading…</p>
                ) : detailsError ? (
                  <p className="text-sm text-rose-700">{detailsError}</p>
                ) : details ? (
                  <pre className="whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800">
                    {JSON.stringify(details, null, 2)}
                  </pre>
                ) : (
                  <p className="text-sm text-slate-500">No details.</p>
                )}
              </div>

              <p className="mt-4 text-xs text-slate-500">
                Next improvement: replace this JSON view with a clean grouped layout (Driver License,
                Vehicle, Registration, etc.).
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
