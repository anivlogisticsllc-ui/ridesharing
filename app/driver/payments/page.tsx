// app/driver/payments/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const ROUTES = {
  login: "/auth/login",
  membership: "/billing/membership",
  driverPortal: "/driver/portal",
  payouts: "/driver/payouts",
} as const;

type LedgerSettlementType =
  | "CARD_PAYOUT"
  | "CASH_COLLECTED"
  | "CASH_PRESERVED"
  | "REFUND_ADJUSTED"
  | "UNKNOWN";

type DriverTransaction = {
  id: string;
  rideId: string;
  bookingId: string;
  createdAt: string;
  status: string;

  grossAmountCents: number;
  serviceFeeCents: number;
  netAmountCents: number;

  paymentType: "CARD" | "CASH" | "UNKNOWN";
  originalPaymentType: "CARD" | "CASH" | "UNKNOWN";

  settlementType: LedgerSettlementType;
  payoutEligible: boolean;
  exclusionReason: string | null;

  refundIssued: boolean;
  refundAmountCents: number;
  refundIssuedAt: string | null;

  originalGrossAmountCents: number;
  originalServiceFeeCents: number;
  originalNetAmountCents: number;

  payoutWeekKey: string;
  payoutWeekStart: string;
  payoutWeekEnd: string;

  ride: {
    id: string;
    departureTime: string | null;
    originCity: string | null;
    destinationCity: string | null;
    status: string | null;
  } | null;
};

type DriverMembershipCharge = {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
  failedAt: string | null;
};

type DriverBillingApi =
  | {
      ok: true;
      payouts: {
        id: string;
        amountCents: number;
        currency: string;
        status: string;
        createdAt: string;
      }[];
      serviceFees: {
        totalFeesCents: number;
        currency: string;
        rideCount: number;
      };
      earningsSummary: {
        grossAmountCents: number;
        serviceFeeCents: number;
        netAmountCents: number;
        pendingNetAmountCents: number;
        paidNetAmountCents: number;
        rideCount: number;
        bankPayoutEligibleNetAmountCents: number;
        excludedFromBankPayoutNetAmountCents: number;
      };
      transactions: DriverTransaction[];
      weeklyPayouts: {
        key: string;
        weekStart: string;
        weekEnd: string;
        label: string;
        payoutStatus: "PAID" | "PENDING" | "NONE";
        payoutId: string | null;
        payoutCreatedAt: string | null;
        payoutAmountCents: number;
        includedGrossAmountCents: number;
        includedServiceFeeCents: number;
        includedNetAmountCents: number;
        excludedGrossAmountCents: number;
        excludedServiceFeeCents: number;
        excludedNetAmountCents: number;
        includedRideCount: number;
        excludedRideCount: number;
        rides: DriverTransaction[];
      }[];
      payoutView: {
        defaultWeekKey: string | null;
        lastPaidWeekKey: string | null;
        currentPendingWeekKey: string | null;
        weekOptions: {
          key: string;
          label: string;
          payoutStatus: "PAID" | "PENDING" | "NONE";
          payoutAmountCents: number;
          includedNetAmountCents: number;
          includedRideCount: number;
          excludedRideCount: number;
        }[];
      };
      membershipCharges: DriverMembershipCharge[];
    }
  | { ok: false; error: string };

type DateRangeFilter = "LAST_7" | "LAST_30" | "THIS_MONTH" | "THIS_YEAR" | "ALL";
type SettlementFilter =
  | "ALL"
  | "CARD_PAYOUT"
  | "CASH_COLLECTED"
  | "CASH_PRESERVED"
  | "REFUND_ADJUSTED"
  | "UNKNOWN";
type PayoutFilter = "ALL" | "BANK_PAYOUT_ONLY" | "EXCLUDED_ONLY";

function money(cents: number, currency: string = "USD") {
  const amount = (Number.isFinite(cents) ? cents : 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (currency || "USD").toUpperCase(),
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${(currency || "USD").toUpperCase()}`;
  }
}

function safeDate(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function routeLabel(t: DriverTransaction) {
  const from = t.ride?.originCity?.trim() || "Unknown";
  const to = t.ride?.destinationCity?.trim() || "Unknown";
  return `${from} → ${to}`;
}

function statusPill(status: string) {
  const s = String(status || "").toUpperCase();

  const cls =
    s === "COMPLETED" || s === "SUCCEEDED" || s === "PAID"
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
      : s === "FAILED" || s === "REFUNDED" || s === "CANCELED" || s === "CANCELLED"
      ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
      : s === "PENDING"
      ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
      : "bg-slate-50 text-slate-700 ring-1 ring-slate-200";

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {s || "—"}
    </span>
  );
}

function settlementPill(value: LedgerSettlementType) {
  const map: Record<LedgerSettlementType, { label: string; cls: string }> = {
    CARD_PAYOUT: {
      label: "Card payout",
      cls: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
    },
    CASH_COLLECTED: {
      label: "Cash collected",
      cls: "bg-slate-50 text-slate-700 ring-1 ring-slate-200",
    },
    CASH_PRESERVED: {
      label: "Cash preserved",
      cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    },
    REFUND_ADJUSTED: {
      label: "Refund adjusted",
      cls: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
    },
    UNKNOWN: {
      label: "Unknown",
      cls: "bg-slate-50 text-slate-700 ring-1 ring-slate-200",
    },
  };

  const item = map[value] ?? map.UNKNOWN;

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${item.cls}`}>
      {item.label}
    </span>
  );
}

function payoutEligiblePill(value: boolean) {
  return value ? (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
      Yes
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-slate-50 text-slate-700 ring-1 ring-slate-200">
      No
    </span>
  );
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function startOfYear() {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
}

function matchesDateRange(date: Date, range: DateRangeFilter) {
  const now = new Date();

  if (range === "ALL") return true;

  if (range === "LAST_7") {
    const cutoff = new Date();
    cutoff.setDate(now.getDate() - 7);
    return date >= cutoff;
  }

  if (range === "LAST_30") {
    const cutoff = new Date();
    cutoff.setDate(now.getDate() - 30);
    return date >= cutoff;
  }

  if (range === "THIS_MONTH") {
    return date >= startOfMonth();
  }

  if (range === "THIS_YEAR") {
    return date >= startOfYear();
  }

  return true;
}

export default function DriverPaymentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DriverBillingApi | null>(null);

  const [dateRange, setDateRange] = useState<DateRangeFilter>("LAST_30");
  const [settlementFilter, setSettlementFilter] = useState<SettlementFilter>("ALL");
  const [payoutFilter, setPayoutFilter] = useState<PayoutFilter>("ALL");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace(`${ROUTES.login}?callbackUrl=${encodeURIComponent("/driver/payments")}`);
      return;
    }

    const role = (session.user as { role?: string } | undefined)?.role;
    if (role !== "DRIVER" && role !== "ADMIN") {
      router.replace("/");
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/account/billing/driver", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as DriverBillingApi | null;

        if (!res.ok || !json || !("ok" in json) || !json.ok) {
          throw new Error((json as { error?: string } | null)?.error || "Failed to load driver payments");
        }

        if (!cancelled) setData(json);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load driver payments");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [session, status, router]);

  const transactions = useMemo(() => {
    if (!data || !data.ok) return [];

    return data.transactions.filter((t) => {
      const rideDate = safeDate(t.ride?.departureTime || t.createdAt);
      if (!rideDate) return false;

      if (!matchesDateRange(rideDate, dateRange)) return false;

      if (settlementFilter !== "ALL" && t.settlementType !== settlementFilter) return false;

      if (payoutFilter === "BANK_PAYOUT_ONLY" && !t.payoutEligible) return false;
      if (payoutFilter === "EXCLUDED_ONLY" && t.payoutEligible) return false;

      const q = search.trim().toLowerCase();
      if (q) {
        const haystack = [
          t.ride?.originCity ?? "",
          t.ride?.destinationCity ?? "",
          t.rideId,
          t.bookingId,
          t.exclusionReason ?? "",
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [data, dateRange, settlementFilter, payoutFilter, search]);

  const summary = useMemo(() => {
    const grossAmountCents = transactions.reduce((sum, t) => sum + t.grossAmountCents, 0);
    const serviceFeeCents = transactions.reduce((sum, t) => sum + t.serviceFeeCents, 0);
    const netAmountCents = transactions.reduce((sum, t) => sum + t.netAmountCents, 0);
    const bankPayoutAmountCents = transactions
      .filter((t) => t.payoutEligible)
      .reduce((sum, t) => sum + t.netAmountCents, 0);
    const excludedFromBankPayoutCents = transactions
      .filter((t) => !t.payoutEligible)
      .reduce((sum, t) => sum + t.netAmountCents, 0);

    return {
      rideCount: transactions.length,
      grossAmountCents,
      serviceFeeCents,
      netAmountCents,
      bankPayoutAmountCents,
      excludedFromBankPayoutCents,
    };
  }, [transactions]);

  const resetFilters = () => {
    setDateRange("LAST_30");
    setSettlementFilter("ALL");
    setPayoutFilter("ALL");
    setSearch("");
  };

  if (status === "loading" || loading) {
    return <p className="py-10 text-center text-slate-600">Loading…</p>;
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Driver payments</h1>
          <p className="mt-2 text-sm text-slate-600">
            Earnings ledger for completed rides and membership billing.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <Link
              className="rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              href={ROUTES.payouts}
            >
              Payouts
            </Link>

            <Link
              className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
              href={ROUTES.membership}
            >
              Membership billing
            </Link>

            <Link
              className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
              href={ROUTES.driverPortal}
            >
              Driver portal
            </Link>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700 shadow-sm">
            {error}
          </div>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Filters</h2>
          <p className="mt-1 text-xs text-slate-500">
            Default view shows the last 30 days to keep this ledger manageable.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Date range
              </label>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as DateRangeFilter)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="LAST_7">Last 7 days</option>
                <option value="LAST_30">Last 30 days</option>
                <option value="THIS_MONTH">This month</option>
                <option value="THIS_YEAR">This year</option>
                <option value="ALL">All time</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Settlement
              </label>
              <select
                value={settlementFilter}
                onChange={(e) => setSettlementFilter(e.target.value as SettlementFilter)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="ALL">All</option>
                <option value="CARD_PAYOUT">Card payout</option>
                <option value="CASH_COLLECTED">Cash collected</option>
                <option value="CASH_PRESERVED">Cash preserved</option>
                <option value="REFUND_ADJUSTED">Refund adjusted</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Bank payout
              </label>
              <select
                value={payoutFilter}
                onChange={(e) => setPayoutFilter(e.target.value as PayoutFilter)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="ALL">All</option>
                <option value="BANK_PAYOUT_ONLY">Bank payout only</option>
                <option value="EXCLUDED_ONLY">Excluded from bank payout</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Search route
              </label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="City, route, ride id..."
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Reset filters
            </button>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Rides shown</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{summary.rideCount}</div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Gross</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{money(summary.grossAmountCents)}</div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Platform fee</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{money(summary.serviceFeeCents)}</div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Driver net</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{money(summary.netAmountCents)}</div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Bank payout portion</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{money(summary.bankPayoutAmountCents)}</div>
            <p className="mt-1 text-[11px] text-slate-500">
              Excluded: {money(summary.excludedFromBankPayoutCents)}
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Ride earnings</h2>
          <p className="mt-1 text-xs text-slate-500">
            This page shows earnings accounting. Cash rides still count in earnings, but do not transfer to bank payout.
          </p>

          {transactions.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No driver transactions match the current filters.</p>
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-left">Route</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-left">Settlement</th>
                      <th className="px-4 py-2 text-left">Bank payout</th>
                      <th className="px-4 py-2 text-left">Reason</th>
                      <th className="px-4 py-2 text-right">Gross</th>
                      <th className="px-4 py-2 text-right">Fee</th>
                      <th className="px-4 py-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t) => (
                      <tr key={t.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 text-slate-700">
                          {safeDate(t.ride?.departureTime || t.createdAt)?.toLocaleDateString() || "—"}
                        </td>
                        <td className="px-4 py-2 text-slate-700">{routeLabel(t)}</td>
                        <td className="px-4 py-2">{statusPill(t.status)}</td>
                        <td className="px-4 py-2">{settlementPill(t.settlementType)}</td>
                        <td className="px-4 py-2">{payoutEligiblePill(t.payoutEligible)}</td>
                        <td className="px-4 py-2 text-slate-600">
                          {t.exclusionReason || "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-medium text-slate-900">
                          {money(t.grossAmountCents)}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-700">
                          {money(t.serviceFeeCents)}
                        </td>
                        <td className="px-4 py-2 text-right font-medium text-slate-900">
                          {money(t.netAmountCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
                Cash rides, including cash-preserved rides, remain earnings but do not transfer to bank payout.
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Membership charges</h2>
          <p className="mt-1 text-xs text-slate-500">Your membership billing history.</p>

          {!data || !data.ok || data.membershipCharges.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No membership charges yet.</p>
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.membershipCharges.map((c) => (
                      <tr key={c.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 text-slate-700">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2">{statusPill(c.status)}</td>
                        <td className="px-4 py-2 text-right font-medium text-slate-900">
                          {money(c.amountCents, c.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}