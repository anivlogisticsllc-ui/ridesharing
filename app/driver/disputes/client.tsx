// OATH: Clean replacement file
// FILE: app/driver/disputes/client.tsx

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type DriverDisputeListItem = {
  bookingId: string;
  rideId: string | null;
  routeLabel: string;
  amountCents: number | null;
  currency: string | null;
  riderName: string | null;
  driverReportedReason: string | null;
  fallbackCardChargedAt: string | null;
  riderDisputedAt: string | null;
  disputeStatus: string | null;
};

type DriverDisputesListResponse =
  | {
      ok: true;
      disputes: DriverDisputeListItem[];
    }
  | {
      ok: false;
      error: string;
    };

function money(cents: number | null | undefined, currency?: string | null) {
  const amount = (typeof cents === "number" ? cents : 0) / 100;
  const c = (currency || "USD").toUpperCase();

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: c,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${c}`;
  }
}

function driverReasonLabel(v: string | null | undefined) {
  if (v === "RIDER_REFUSED_CASH") return "Driver reported rider refused cash";
  if (v === "RIDER_NO_CASH") return "Driver reported rider had no cash";
  if (v === "OTHER") return "Other";
  return "Not specified";
}

function disputeStatusLabel(v: string | null | undefined) {
  if (!v) return "No dispute";
  if (v === "OPEN") return "Open";
  if (v === "UNDER_REVIEW") return "Under review";
  if (v === "RESOLVED_RIDER") return "Resolved in rider's favor";
  if (v === "RESOLVED_DRIVER") return "Resolved in driver's favor";
  if (v === "CLOSED") return "Closed";
  return v;
}

export default function DriverDisputesPageClient() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DriverDisputeListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/driver/disputes", {
          cache: "no-store",
        });

        const json = (await res.json().catch(() => null)) as DriverDisputesListResponse | null;

        if (!res.ok || !json) {
          throw new Error("Failed to load driver disputes.");
        }

        if (json.ok === false) {
          throw new Error(json.error || "Failed to load driver disputes.");
        }

        if (!cancelled) {
          setItems(json.disputes);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load driver disputes."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Driver disputes
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Review disputes submitted by riders for fallback card charges.
            </p>
          </div>

          <Link
            href="/driver/portal"
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back
          </Link>
        </div>

        {loading ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Loading dispute cases…</p>
          </section>
        ) : error ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
            <p className="text-sm font-medium text-rose-700">
              Could not load driver disputes
            </p>
            <p className="mt-1 text-sm text-rose-700">{error}</p>
          </section>
        ) : items.length === 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">
              No disputes yet
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              When a rider submits a dispute for one of your rides, it will appear here.
            </p>
          </section>
        ) : (
          <div className="space-y-4">
            {items.map((item) => (
              <Link
                key={item.bookingId}
                href={`/driver/disputes/${encodeURIComponent(item.bookingId)}`}
                className="block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">
                      {item.routeLabel}
                    </div>

                    <div className="mt-2 space-y-1 text-sm text-slate-600">
                      <p>
                        <span className="font-medium text-slate-700">Rider:</span>{" "}
                        {item.riderName || "Unknown"}
                      </p>
                      <p>
                        <span className="font-medium text-slate-700">
                          Reported reason:
                        </span>{" "}
                        {driverReasonLabel(item.driverReportedReason)}
                      </p>
                      <p>
                        <span className="font-medium text-slate-700">
                          Fallback charged:
                        </span>{" "}
                        {item.fallbackCardChargedAt
                          ? new Date(item.fallbackCardChargedAt).toLocaleString()
                          : "Unknown"}
                      </p>
                      <p>
                        <span className="font-medium text-slate-700">Status:</span>{" "}
                        {disputeStatusLabel(item.disputeStatus)}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 text-left md:text-right">
                    <div className="text-sm font-semibold text-slate-900">
                      {money(item.amountCents, item.currency)}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      {item.riderDisputedAt
                        ? `Submitted ${new Date(item.riderDisputedAt).toLocaleString()}`
                        : "Open case"}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
