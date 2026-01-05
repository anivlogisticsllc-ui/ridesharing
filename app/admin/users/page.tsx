// app/admin/users/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: "RIDER" | "DRIVER";
  isAdmin: boolean;
  accountStatus: "ACTIVE" | "SUSPENDED" | "DISABLED";
  createdAt: string;
  updatedAt: string;
  publicId: string | null;
  onboardingCompleted: boolean;
  membershipActive: boolean;
  membershipPlan: string | null;
  trialEndsAt: string | null;
};

type UsersResponse =
  | { ok: true; users: UserRow[] }
  | { ok: false; error: string };

type PatchResponse =
  | { ok: true; user: Pick<UserRow, "id" | "email" | "name" | "role" | "isAdmin" | "accountStatus" | "updatedAt"> }
  | { ok: false; error: string };

function Pill(props: { children: React.ReactNode }) {
  return (
    <span style={{ padding: "2px 8px", borderRadius: 999, border: "1px solid #e5e7eb", background: "#f9fafb", fontSize: 12 }}>
      {props.children}
    </span>
  );
}

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"" | "RIDER" | "DRIVER" >("");
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      setLoading(true);

      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (role) params.set("role", role);

      const res = await fetch(`/api/admin/users?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as UsersResponse | null;

      if (!res.ok || !data || !data.ok) {
        setRows([]);
        setError((data as any)?.error || `Failed to load users (HTTP ${res.status})`);
        return;
      }

      setRows(data.users);
    } catch (e) {
      console.error(e);
      setRows([]);
      setError("Failed to load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function patchUser(userId: string, patch: Partial<Pick<UserRow, "role" | "accountStatus" | "isAdmin">>) {
    try {
      setSavingId(userId);
      setError(null);

      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...patch }),
      });

      const data = (await res.json().catch(() => null)) as PatchResponse | null;
      if (!res.ok || !data || !data.ok) {
        setError((data as any)?.error || `Update failed (HTTP ${res.status})`);
        return;
      }

      setRows((prev) => prev.map((u) => (u.id === userId ? { ...u, ...data.user } as any : u)));
    } catch (e) {
      console.error(e);
      setError("Update failed.");
    } finally {
      setSavingId(null);
    }
  }

  const filtered = useMemo(() => rows, [rows]);

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px 40px", fontFamily: "system-ui" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 750 }}>Admin users</h1>
          <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 14 }}>
            Search + edit roles, status, and admin flag.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link href="/admin">
            <button type="button" style={{ borderRadius: 999, border: "1px solid #d1d5db", background: "#fff", padding: "8px 12px" }}>
              Back
            </button>
          </Link>
          <button
            type="button"
            onClick={load}
            style={{ borderRadius: 999, border: "none", background: "#111827", color: "#fff", padding: "8px 12px" }}
          >
            Refresh
          </button>
        </div>
      </header>

      <div style={{ height: 14 }} />

      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
          background: "#fff",
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search email, name, publicId…"
          style={{
            flex: "1 1 260px",
            border: "1px solid #d1d5db",
            borderRadius: 10,
            padding: "8px 10px",
            fontSize: 14,
          }}
        />

        <select
          value={role}
          onChange={(e) => setRole(e.target.value as any)}
          style={{ border: "1px solid #d1d5db", borderRadius: 10, padding: "8px 10px", fontSize: 14 }}
        >
          <option value="">All roles</option>
          <option value="RIDER">RIDER</option>
          <option value="DRIVER">DRIVER</option>
        </select>

        <button
          type="button"
          onClick={load}
          style={{ borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", padding: "8px 12px", cursor: "pointer" }}
        >
          Apply
        </button>
      </section>

      <div style={{ height: 10 }} />

      {loading ? <p style={{ color: "#6b7280" }}>Loading…</p> : null}
      {!loading && error ? <p style={{ color: "#dc2626" }}>{error}</p> : null}

      {!loading && !error ? (
        <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>User</th>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>Role</th>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>Status</th>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>Admin</th>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>Flags</th>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>Created</th>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const busy = savingId === u.id;
                return (
                  <tr key={u.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: 10 }}>
                      <div style={{ fontWeight: 650 }}>{u.name || "(no name)"}</div>
                      <div style={{ color: "#6b7280" }}>{u.email}</div>
                      {u.publicId ? <div style={{ color: "#6b7280" }}>publicId: {u.publicId}</div> : null}
                    </td>

                    <td style={{ padding: 10 }}>
                      <select
                        value={u.role}
                        disabled={busy}
                        onChange={(e) => patchUser(u.id, { role: e.target.value as any })}
                        style={{ border: "1px solid #d1d5db", borderRadius: 10, padding: "6px 8px" }}
                      >
                        <option value="RIDER">RIDER</option>
                        <option value="DRIVER">DRIVER</option>
                      </select>
                    </td>

                    <td style={{ padding: 10 }}>
                      <select
                        value={u.accountStatus}
                        disabled={busy}
                        onChange={(e) => patchUser(u.id, { accountStatus: e.target.value as any })}
                        style={{ border: "1px solid #d1d5db", borderRadius: 10, padding: "6px 8px" }}
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="SUSPENDED">SUSPENDED</option>
                        <option value="DISABLED">DISABLED</option>
                      </select>
                    </td>

                    <td style={{ padding: 10 }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={u.isAdmin}
                          disabled={busy}
                          onChange={(e) => patchUser(u.id, { isAdmin: e.target.checked })}
                        />
                        <span style={{ color: "#374151" }}>{u.isAdmin ? "Yes" : "No"}</span>
                      </label>
                    </td>

                    <td style={{ padding: 10 }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {u.onboardingCompleted ? <Pill>onboarded</Pill> : <Pill>not onboarded</Pill>}
                        {u.membershipActive ? <Pill>membership active</Pill> : <Pill>membership off</Pill>}
                        {u.membershipPlan ? <Pill>{u.membershipPlan}</Pill> : null}
                      </div>
                    </td>

                    <td style={{ padding: 10, color: "#6b7280" }}>{new Date(u.createdAt).toLocaleString()}</td>
                    <td style={{ padding: 10, color: "#6b7280" }}>{new Date(u.updatedAt).toLocaleString()}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 14, color: "#6b7280" }}>
                    No users found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
