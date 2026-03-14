// OATH: Clean replacement file
// FILE: app/admin/disputes/client.tsx

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type AdminDisputeListItem = {
  disputeId: string;
  bookingId: string;
  rideId: string | null;
  routeLabel: string;
  amountCents: number | null;
  currency: string | null;
  riderName: string | null;
  driverName: string | null;
  driverReportedReason: string | null;
  fallbackCardChargedAt: string | null;
  riderDisputedAt: string | null;
  disputeStatus: string | null;
};

type AdminDisputesResponse =
  | {
      ok: true;
      disputes: AdminDisputeListItem[];
    }
  | {
      ok: false;
      error: string;
    };

type FilterKey = "ALL" | "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "CLOSED";

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

function reasonLabel(v: string | null | undefined) {
  if (v === "RIDER_REFUSED_CASH") return "Driver reported rider refused cash";
  if (v === "RIDER_NO_CASH") return "Driver reported rider had no cash";
  if (v === "OTHER") return "Other";
  return "Not specified";
}

function statusLabel(v: string | null | undefined) {
  if (!v) return "Unknown";
  if (v === "OPEN") return "Open";
  if (v === "UNDER_REVIEW") return "Under review";
  if (v === "RESOLVED_RIDER") return "Resolved in rider's favor";
  if (v === "RESOLVED_DRIVER") return "Resolved in driver's favor";
  if (v === "CLOSED") return "Closed";
  return v;
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full border px-4 py-2 text-sm font-medium transition",
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export default function AdminDisputesPageClient() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AdminDisputeListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterKey>("ALL");

  const [disputeIdQuery, setDisputeIdQuery] = useState("");
  const [riderQuery, setRiderQuery] = useState("");
  const [driverQuery, setDriverQuery] = useState("");
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [appliedDisputeIdQuery, setAppliedDisputeIdQuery] = useState("");
  const [appliedRiderQuery, setAppliedRiderQuery] = useState("");
  const [appliedDriverQuery, setAppliedDriverQuery] = useState("");
  const [appliedFromQuery, setAppliedFromQuery] = useState("");
  const [appliedToQuery, setAppliedToQuery] = useState("");
  const [appliedDateFrom, setAppliedDateFrom] = useState("");
  const [appliedDateTo, setAppliedDateTo] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();

    if (filter !== "ALL") {
      params.set("status", filter);
    }
    if (appliedDisputeIdQuery) {
      params.set("disputeId", appliedDisputeIdQuery);
    }
    if (appliedRiderQuery) {
      params.set("rider", appliedRiderQuery);
    }
    if (appliedDriverQuery) {
      params.set("driver", appliedDriverQuery);
    }
    if (appliedFromQuery) {
      params.set("from", appliedFromQuery);
    }
    if (appliedToQuery) {
      params.set("to", appliedToQuery);
    }
    if (appliedDateFrom) {
      params.set("dateFrom", appliedDateFrom);
    }
    if (appliedDateTo) {
      params.set("dateTo", appliedDateTo);
    }

    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [
    filter,
    appliedDisputeIdQuery,
    appliedRiderQuery,
    appliedDriverQuery,
    appliedFromQuery,
    appliedToQuery,
    appliedDateFrom,
    appliedDateTo,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/admin/disputes${queryString}`, {
          cache: "no-store",
        });

        const json = (await res.json().catch(() => null)) as AdminDisputesResponse | null;

        if (!res.ok || !json) {
          throw new Error("Failed to load disputes.");
        }

        if (json.ok === false) {
          throw new Error(json.error || "Failed to load disputes.");
        }

        if (!cancelled) {
          setItems(json.disputes);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load disputes.");
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
  }, [queryString]);

  const counts = useMemo(() => {
    return {
      all: items.length,
      open: items.filter((x) => x.disputeStatus === "OPEN").length,
      underReview: items.filter((x) => x.disputeStatus === "UNDER_REVIEW").length,
      resolved: items.filter(
        (x) =>
          x.disputeStatus === "RESOLVED_RIDER" ||
          x.disputeStatus === "RESOLVED_DRIVER"
      ).length,
      closed: items.filter((x) => x.disputeStatus === "CLOSED").length,
    };
  }, [items]);

  function applyCustomFilters() {
    setAppliedDisputeIdQuery(disputeIdQuery.trim());
    setAppliedRiderQuery(riderQuery.trim());
    setAppliedDriverQuery(driverQuery.trim());
    setAppliedFromQuery(fromQuery.trim());
    setAppliedToQuery(toQuery.trim());
    setAppliedDateFrom(dateFrom.trim());
    setAppliedDateTo(dateTo.trim());
  }

  function resetCustomFilters() {
    setDisputeIdQuery("");
    setRiderQuery("");
    setDriverQuery("");
    setFromQuery("");
    setToQuery("");
    setDateFrom("");
    setDateTo("");

    setAppliedDisputeIdQuery("");
    setAppliedRiderQuery("");
    setAppliedDriverQuery("");
    setAppliedFromQuery("");
    setAppliedToQuery("");
    setAppliedDateFrom("");
    setAppliedDateTo("");
    setFilter("ALL");
  }

  const hasAppliedCustomFilters = useMemo(() => {
    return Boolean(
      appliedDisputeIdQuery ||
        appliedRiderQuery ||
        appliedDriverQuery ||
        appliedFromQuery ||
        appliedToQuery ||
        appliedDateFrom ||
        appliedDateTo
    );
  }, [
    appliedDisputeIdQuery,
    appliedRiderQuery,
    appliedDriverQuery,
    appliedFromQuery,
    appliedToQuery,
    appliedDateFrom,
    appliedDateTo,
  ]);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Admin disputes</h1>
            <p className="mt-1 text-sm text-slate-600">
              Review and manage fallback card charge disputes.
            </p>
          </div>

          <Link
            href="/admin"
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back
          </Link>
        </div>

        {loading ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Loading disputes…</p>
          </section>
        ) : error ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
            <p className="text-sm font-medium text-rose-700">Could not load disputes</p>
            <p className="mt-1 text-sm text-rose-700">{error}</p>
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap gap-2">
                <FilterButton active={filter === "ALL"} onClick={() => setFilter("ALL")}>
                  All ({counts.all})
                </FilterButton>
                <FilterButton active={filter === "OPEN"} onClick={() => setFilter("OPEN")}>
                  Open ({counts.open})
                </FilterButton>
                <FilterButton
                  active={filter === "UNDER_REVIEW"}
                  onClick={() => setFilter("UNDER_REVIEW")}
                >
                  Under review ({counts.underReview})
                </FilterButton>
                <FilterButton
                  active={filter === "RESOLVED"}
                  onClick={() => setFilter("RESOLVED")}
                >
                  Resolved ({counts.resolved})
                </FilterButton>
                <FilterButton
                  active={filter === "CLOSED"}
                  onClick={() => setFilter("CLOSED")}
                >
                  Closed ({counts.closed})
                </FilterButton>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Custom filters</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Filter by dispute, people, route, and date range.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Dispute ID
                  </label>
                  <input
                    type="text"
                    value={disputeIdQuery}
                    onChange={(e) => setDisputeIdQuery(e.target.value)}
                    placeholder="Enter dispute ID"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Rider
                  </label>
                  <input
                    type="text"
                    value={riderQuery}
                    onChange={(e) => setRiderQuery(e.target.value)}
                    placeholder="Rider name"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Driver
                  </label>
                  <input
                    type="text"
                    value={driverQuery}
                    onChange={(e) => setDriverQuery(e.target.value)}
                    placeholder="Driver name"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    From
                  </label>
                  <input
                    type="text"
                    value={fromQuery}
                    onChange={(e) => setFromQuery(e.target.value)}
                    placeholder="Origin city"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    To
                  </label>
                  <input
                    type="text"
                    value={toQuery}
                    onChange={(e) => setToQuery(e.target.value)}
                    placeholder="Destination city"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Date from
                  </label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Date to
                  </label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={applyCustomFilters}
                  className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Apply filters
                </button>

                <button
                  type="button"
                  onClick={resetCustomFilters}
                  className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Reset
                </button>
              </div>

              {hasAppliedCustomFilters ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  Custom filters are active.
                </div>
              ) : null}
            </section>

            {items.length === 0 ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">
                  No disputes found
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Try changing the status or custom filters.
                </p>
              </section>
            ) : (
              <div className="space-y-4">
                {items.map((item) => (
                  <Link
                    key={item.disputeId}
                    href={`/admin/disputes/${encodeURIComponent(item.disputeId)}`}
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
                            <span className="font-medium text-slate-700">Driver:</span>{" "}
                            {item.driverName || "Unknown"}
                          </p>
                          <p>
                            <span className="font-medium text-slate-700">
                              Reported reason:
                            </span>{" "}
                            {reasonLabel(item.driverReportedReason)}
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
                            {statusLabel(item.disputeStatus)}
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
          </>
        )}
      </div>
    </main>
  );
}
