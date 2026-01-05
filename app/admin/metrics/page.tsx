// app/admin/metrics/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

function Card(props: { label: string; value: number | string }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 14 }}>
      <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase" }}>{props.label}</div>
      <div style={{ fontSize: 22, fontWeight: 750, marginTop: 6 }}>{props.value}</div>
    </div>
  );
}

export default function AdminMetricsPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      setLoading(true);
      const res = await fetch("/api/admin/metrics", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as MetricsResponse | null;

      if (!res.ok || !data || !data.ok) {
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
    load();
  }, []);

  const cards = useMemo(() => {
    if (!metrics) return [];
    return [
      ["Open rides", metrics.openRides],
      ["Accepted rides", metrics.acceptedRides],
      ["In route", metrics.inRouteRides],
      ["Completed today", metrics.completedToday],
      ["Cancelled today", metrics.cancelledToday],
      ["Users total", metrics.usersTotal],
      ["Drivers total", metrics.driversTotal],
    ] as const;
  }, [metrics]);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px 40px", fontFamily: "system-ui" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 750 }}>Admin metrics</h1>
          <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 14 }}>Live counts from the database.</p>
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

      {loading ? <p style={{ color: "#6b7280" }}>Loading…</p> : null}
      {!loading && error ? <p style={{ color: "#dc2626" }}>{error}</p> : null}

      {!loading && !error && metrics ? (
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {cards.map(([label, value]) => (
            <Card key={label} label={label} value={value} />
          ))}
        </section>
      ) : null}
    </main>
  );
}
