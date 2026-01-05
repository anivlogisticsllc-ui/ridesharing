// app/admin/riders/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type RiderRow = {
  id: string;
  email: string;
  name: string | null;
  role: "RIDER" | "DRIVER";
  publicId: string | null;
  createdAt: string;
  onboardingCompleted: boolean;
  ratingAverage: number;
  ratingCount: number;
};

type RidersResponse =
  | { ok: true; riders: RiderRow[] }
  | { ok: false; error: string };

export default function AdminRidersPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<RiderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(query?: string) {
    try {
      setError(null);
      setLoading(true);

      const params = new URLSearchParams();
      if (query?.trim()) params.set("q", query.trim());

      const res = await fetch(`/api/admin/riders?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as RidersResponse | null;

      if (!res.ok || !data || !data.ok) {
        setRows([]);
        setError((data as any)?.error || `Failed to load riders (HTTP ${res.status})`);
        return;
      }

      setRows(data.riders);
    } catch (e) {
      console.error(e);
      setRows([]);
      setError("Failed to load riders.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("");
  }, []);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px 40px", fontFamily: "system-ui" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 750 }}>Riders</h1>
          <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 14 }}>Riders list (role RIDER).</p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link href="/admin">
            <button type="button" style={{ borderRadius: 999, border: "1px solid #d1d5db", background: "#fff", padding: "8px 12px" }}>
              Back
            </button>
          </Link>
          <button
            type="button"
            onClick={() => load(q)}
            style={{ borderRadius: 999, border: "none", background: "#111827", color: "#fff", padding: "8px 12px" }}
          >
            Refresh
          </button>
        </div>
      </header>

      <div style={{ height: 14 }} />

      <section style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search email, name, publicId…"
          style={{ flex: "1 1 260px", border: "1px solid #d1d5db", borderRadius: 10, padding: "8px 10px", fontSize: 14 }}
        />
        <button
          type="button"
          onClick={() => load(q)}
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
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>Rider</th>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>Role</th>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>Rating</th>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>Onboarding</th>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: 10 }}>
                    <div style={{ fontWeight: 650 }}>{r.name || "(no name)"}</div>
                    <div style={{ color: "#6b7280" }}>{r.email}</div>
                    {r.publicId ? <div style={{ color: "#6b7280" }}>publicId: {r.publicId}</div> : null}
                  </td>
                  <td style={{ padding: 10 }}>{r.role}</td>
                  <td style={{ padding: 10 }}>
                    {r.ratingCount > 0 ? `${r.ratingAverage.toFixed(2)} (${r.ratingCount})` : "—"}
                  </td>
                  <td style={{ padding: 10 }}>{r.onboardingCompleted ? "Completed" : "Not completed"}</td>
                  <td style={{ padding: 10, color: "#6b7280" }}>{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 14, color: "#6b7280" }}>
                    No riders found.
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
