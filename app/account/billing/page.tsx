"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Role = "RIDER" | "DRIVER" | "ADMIN";

function asRole(v: unknown): Role | null {
  return v === "RIDER" || v === "DRIVER" || v === "ADMIN" ? v : null;
}

type RiderPayment = {
  id: string;
  createdAt: string;
  status: string;
  currency: string;
  amountCents: number;
  paymentType: "CARD" | "CASH" | "UNKNOWN";
  ride?: {
    id: string;
    departureTime: string | null;
    originCity: string | null;
    destinationCity: string | null;
    status: string | null;
  } | null;
  paymentMethod?: {
    id: string;
    provider: string;
    brand: string | null;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
  } | null;
};

type DriverPayout = {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  createdAt: string;
};

type DriverTransaction = {
  id: string;
  rideId: string;
  createdAt: string;
  status: string;
  grossAmountCents: number;
  serviceFeeCents: number;
  netAmountCents: number;
  paymentType: "CARD" | "CASH" | "UNKNOWN";
  payoutEligible: boolean;
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

type RiderApiResponse =
  | {
      ok: true;
      payments: RiderPayment[];
      summary: {
        count: number;
        totalAmountCents: number;
      };
    }
  | { ok: false; error: string };

type DriverApiResponse =
  | {
      ok: true;
      payouts: DriverPayout[];
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
      };
      transactions: DriverTransaction[];
      membershipCharges: DriverMembershipCharge[];
    }
  | { ok: false; error: string };

type MeApiResponse =
  | {
      ok: true;
      user: {
        id: string;
        name: string | null;
        email: string;
        role: Role;
        onboardingCompleted: boolean;
        emailVerified?: boolean;
      };
      membership: {
        plan: string | null;
        kind: "NONE" | "TRIAL" | "PAID";
        status: "none" | "trialing" | "active" | "expired";
        active: boolean;
        trialEndsAt: string | null;
        currentPeriodEnd: string | null;
        cancelAtPeriodEnd: boolean;
      };
    }
  | { ok: false; error: string };

type RiderRange = "today" | "yesterday" | "7d" | "30d" | "this_month" | "all" | "custom";
type RiderStatusFilter = "all" | "succeeded" | "completed" | "failed" | "refunded" | "pending";
type RiderMethodFilter = "all" | "card" | "cash" | "unknown";

type DriverRange = "today" | "yesterday" | "7d" | "30d" | "this_month" | "all" | "custom";
type DriverStatusFilter = "all" | "completed" | "pending" | "failed" | "paid";
type DriverMethodFilter = "all" | "card" | "cash" | "unknown";

function money(cents: number, currency: string) {
  const c = (currency || "USD").toUpperCase();
  const amount = (Number.isFinite(cents) ? cents : 0) / 100;

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: c,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${c}`;
  }
}

function methodLabel(p: RiderPayment) {
  if (p.paymentType === "CASH") return "CASH";

  if (p.paymentType === "CARD" && !p.paymentMethod) return "CARD";

  const m = p.paymentMethod;
  if (!m) return "—";

  const brand = (m.brand || m.provider || "").toUpperCase();
  const last4 = m.last4 ? `•••• ${m.last4}` : "";
  const exp =
    m.expMonth && m.expYear
      ? `Exp ${String(m.expMonth).padStart(2, "0")}/${String(m.expYear).slice(-2)}`
      : "";

  return [brand, last4, exp].filter(Boolean).join(" ");
}

function driverMethodLabel(t: DriverTransaction) {
  if (t.paymentType === "CARD") {
    return t.payoutEligible ? "CARD" : "CARD";
  }
  if (t.paymentType === "CASH") {
    return t.payoutEligible ? "CASH → CARD fallback" : "CASH";
  }
  return "UNKNOWN";
}

function payoutEligibilityLabel(t: DriverTransaction) {
  return t.payoutEligible ? "Payout eligible" : "Driver paid directly";
}

function riderRouteLabel(p: RiderPayment) {
  const from = p.ride?.originCity?.trim() || "Unknown";
  const to = p.ride?.destinationCity?.trim() || "Unknown";
  return `${from} → ${to}`;
}

function driverRouteLabel(t: DriverTransaction) {
  const from = t.ride?.originCity?.trim() || "Unknown";
  const to = t.ride?.destinationCity?.trim() || "Unknown";
  return `${from} → ${to}`;
}

function statusPill(status: string) {
  const s = String(status || "").toUpperCase();
  const isGood = ["SUCCEEDED", "PAID", "COMPLETED", "ACTIVE"].includes(s);
  const isBad = ["FAILED", "CANCELED", "CANCELLED", "REFUNDED", "EXPIRED"].includes(s);

  const cls = isGood
    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
    : isBad
    ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
    : "bg-slate-50 text-slate-700 ring-1 ring-slate-200";

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {s || "—"}
    </span>
  );
}

function smallPill(kind: "good" | "warn" | "muted", text: string) {
  const cls =
    kind === "good"
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
      : kind === "warn"
      ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
      : "bg-slate-50 text-slate-700 ring-1 ring-slate-200";

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {text}
    </span>
  );
}

function membershipUi(
  m: MeApiResponse extends { ok: true } ? MeApiResponse["membership"] : any
) {
  const status = m?.status || "none";

  if (status === "active") {
    return { label: "Active", tone: "good" as const, cta: "Manage membership" };
  }

  if (status === "trialing") {
    const ends = m?.trialEndsAt ? new Date(m.trialEndsAt).toLocaleDateString() : null;
    return {
      label: ends ? `Trial (ends ${ends})` : "Trial",
      tone: "good" as const,
      cta: "Manage membership",
    };
  }

  if (status === "expired") {
    const ended = m?.currentPeriodEnd ? new Date(m.currentPeriodEnd).toLocaleDateString() : null;
    return {
      label: ended ? `Expired (ended ${ended})` : "Expired",
      tone: "bad" as const,
      cta: "Activate membership",
    };
  }

  return { label: "Not active", tone: "warn" as const, cta: "Activate membership" };
}

function badge(tone: "good" | "warn" | "bad", text: string) {
  const cls =
    tone === "good"
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
      : tone === "bad"
      ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
      : "bg-amber-50 text-amber-800 ring-1 ring-amber-200";

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {text}
    </span>
  );
}

function yyyyMmDd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateInput(v: string) {
  if (!v) return null;

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  const d = new Date(year, month - 1, day);
  return Number.isNaN(d.getTime()) ? null : d;
}

function matchesRange(rowDate: Date, range: RiderRange | DriverRange, from: string, to: string) {
  const row = new Date(rowDate);
  row.setHours(0, 0, 0, 0);

  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (range === "all") return true;

  if (range === "today") {
    return row.getTime() === startToday.getTime();
  }

  if (range === "yesterday") {
    const yesterday = new Date(startToday);
    yesterday.setDate(yesterday.getDate() - 1);
    return row.getTime() === yesterday.getTime();
  }

  if (range === "7d") {
    const start = new Date(startToday);
    start.setDate(start.getDate() - 6);
    return row >= start;
  }

  if (range === "30d") {
    const start = new Date(startToday);
    start.setDate(start.getDate() - 29);
    return row >= start;
  }

  if (range === "this_month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return row >= start;
  }

  if (range === "custom") {
    const fromDate = parseDateInput(from);
    const toDate = parseDateInput(to);

    if (fromDate && row < fromDate) return false;
    if (toDate && row > toDate) return false;

    return true;
  }

  return true;
}

function matchesRiderStatus(status: string, filter: RiderStatusFilter) {
  const s = String(status || "").toUpperCase();

  if (filter === "all") return true;
  if (filter === "succeeded") return s === "SUCCEEDED";
  if (filter === "completed") return s === "COMPLETED";
  if (filter === "failed") return s === "FAILED";
  if (filter === "refunded") return s === "REFUNDED";
  if (filter === "pending") return s === "PENDING" || s === "AUTHORIZED";

  return true;
}

function matchesDriverStatus(status: string, filter: DriverStatusFilter) {
  const s = String(status || "").toUpperCase();

  if (filter === "all") return true;
  if (filter === "completed") return s === "COMPLETED";
  if (filter === "pending") return s === "PENDING" || s === "AUTHORIZED";
  if (filter === "failed") return s === "FAILED";
  if (filter === "paid") return s === "PAID" || s === "SUCCEEDED";

  return true;
}

function matchesMethod(paymentType: RiderPayment["paymentType"], filter: RiderMethodFilter) {
  if (filter === "all") return true;
  if (filter === "card") return paymentType === "CARD";
  if (filter === "cash") return paymentType === "CASH";
  if (filter === "unknown") return paymentType === "UNKNOWN";
  return true;
}

function matchesDriverMethod(paymentType: DriverTransaction["paymentType"], filter: DriverMethodFilter) {
  if (filter === "all") return true;
  if (filter === "card") return paymentType === "CARD";
  if (filter === "cash") return paymentType === "CASH";
  if (filter === "unknown") return paymentType === "UNKNOWN";
  return true;
}

function matchesRiderQuery(p: RiderPayment, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;

  const hay = [
    p.ride?.originCity || "",
    p.ride?.destinationCity || "",
    p.ride?.id || "",
    p.status || "",
    p.paymentType || "",
    p.paymentMethod?.brand || "",
    p.paymentMethod?.last4 || "",
  ]
    .join(" ")
    .toLowerCase();

  return hay.includes(s);
}

function matchesDriverQuery(t: DriverTransaction, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;

  const hay = [
    t.ride?.originCity || "",
    t.ride?.destinationCity || "",
    t.ride?.id || "",
    t.rideId || "",
    t.status || "",
    t.paymentType || "",
  ]
    .join(" ")
    .toLowerCase();

  return hay.includes(s);
}

export default function AccountBillingPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const role = asRole((session?.user as any)?.role);

  const showRider = role === "RIDER";
  const showDriver = role === "DRIVER" || role === "ADMIN";
  const showBothSections = role === "ADMIN";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [allRiderPayments, setAllRiderPayments] = useState<RiderPayment[]>([]);
  const [driverBilling, setDriverBilling] = useState<DriverApiResponse | null>(null);
  const [meMembership, setMeMembership] = useState<any>(null);

  const [range, setRange] = useState<RiderRange>("30d");
  const [statusFilter, setStatusFilter] = useState<RiderStatusFilter>("all");
  const [methodFilter, setMethodFilter] = useState<RiderMethodFilter>("all");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(() =>
    yyyyMmDd(new Date(new Date().setDate(new Date().getDate() - 29)))
  );
  const [to, setTo] = useState(() => yyyyMmDd(new Date()));

  const [driverRange, setDriverRange] = useState<DriverRange>("30d");
  const [driverStatusFilter, setDriverStatusFilter] = useState<DriverStatusFilter>("all");
  const [driverMethodFilter, setDriverMethodFilter] = useState<DriverMethodFilter>("all");
  const [driverQ, setDriverQ] = useState("");
  const [driverFrom, setDriverFrom] = useState(() =>
    yyyyMmDd(new Date(new Date().setDate(new Date().getDate() - 29)))
  );
  const [driverTo, setDriverTo] = useState(() => yyyyMmDd(new Date()));

  const callbackUrl = useMemo(() => "/account/billing", []);

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace(`/auth/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      return;
    }

    if (!role) {
      router.replace("/");
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const meRes = await fetch("/api/auth/me", { cache: "no-store" });
        const meJson = (await meRes.json().catch(() => null)) as MeApiResponse | null;

        if (meRes.ok && meJson && "ok" in meJson && meJson.ok) {
          if (!cancelled) setMeMembership(meJson.membership);
        } else if (!cancelled) {
          setMeMembership(null);
        }

        if (showRider || showBothSections) {
          const res = await fetch("/api/account/billing/rider?take=1000", {
            cache: "no-store",
          });

          const json = (await res.json().catch(() => null)) as RiderApiResponse | null;
          if (!res.ok || !json || !("ok" in json) || !json.ok) {
            throw new Error((json as any)?.error || "Failed to load rider billing");
          }

          if (!cancelled) setAllRiderPayments(json.payments || []);
        } else if (!cancelled) {
          setAllRiderPayments([]);
        }

        if (showDriver || showBothSections) {
          const res = await fetch("/api/account/billing/driver", { cache: "no-store" });
          const json = (await res.json().catch(() => null)) as DriverApiResponse | null;

          if (!res.ok || !json || !("ok" in json) || !json.ok) {
            throw new Error((json as any)?.error || "Failed to load driver billing");
          }

          if (!cancelled) setDriverBilling(json);
        } else if (!cancelled) {
          setDriverBilling(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load billing data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [session, status, role, router, callbackUrl, showRider, showDriver, showBothSections]);

  const visibleRiderPayments = useMemo(() => {
    return allRiderPayments.filter((p) => {
      const rowDate = new Date(p.createdAt);
      if (Number.isNaN(rowDate.getTime())) return false;

      if (!matchesRange(rowDate, range, from, to)) return false;
      if (!matchesRiderStatus(p.status, statusFilter)) return false;
      if (!matchesMethod(p.paymentType, methodFilter)) return false;
      if (!matchesRiderQuery(p, q)) return false;

      return true;
    });
  }, [allRiderPayments, range, from, to, statusFilter, methodFilter, q]);

  const riderSummary = useMemo(() => {
    const totalAmountCents = visibleRiderPayments.reduce(
      (sum, p) => sum + (p.amountCents || 0),
      0
    );

    return {
      count: visibleRiderPayments.length,
      totalAmountCents,
    };
  }, [visibleRiderPayments]);

  const driverUi = useMemo(() => {
    if (!driverBilling || !driverBilling.ok) return null;

    return {
      serviceFees: driverBilling.serviceFees,
      earningsSummary: driverBilling.earningsSummary,
      transactions: driverBilling.transactions,
      payouts: driverBilling.payouts,
      membershipCharges: driverBilling.membershipCharges,
    };
  }, [driverBilling]);

  const visibleDriverTransactions = useMemo(() => {
    if (!driverUi) return [];

    return driverUi.transactions.filter((t) => {
      const rowDate = new Date(t.createdAt);
      if (Number.isNaN(rowDate.getTime())) return false;

      if (!matchesRange(rowDate, driverRange, driverFrom, driverTo)) return false;
      if (!matchesDriverStatus(t.status, driverStatusFilter)) return false;
      if (!matchesDriverMethod(t.paymentType, driverMethodFilter)) return false;
      if (!matchesDriverQuery(t, driverQ)) return false;

      return true;
    });
  }, [driverUi, driverRange, driverFrom, driverTo, driverStatusFilter, driverMethodFilter, driverQ]);

  const filteredDriverSummary = useMemo(() => {
    const grossAmountCents = visibleDriverTransactions.reduce((sum, t) => sum + (t.grossAmountCents || 0), 0);
    const serviceFeeCents = visibleDriverTransactions.reduce((sum, t) => sum + (t.serviceFeeCents || 0), 0);
    const netAmountCents = visibleDriverTransactions.reduce((sum, t) => sum + (t.netAmountCents || 0), 0);

    const pendingNetAmountCents = visibleDriverTransactions
      .filter((t) => t.payoutEligible)
      .reduce((sum, t) => sum + (t.netAmountCents || 0), 0);

    return {
      rideCount: visibleDriverTransactions.length,
      grossAmountCents,
      serviceFeeCents,
      netAmountCents,
      pendingNetAmountCents,
    };
  }, [visibleDriverTransactions]);

  const totalPaidOut = useMemo(() => {
    if (!driverUi) return 0;

    return driverUi.payouts.reduce((sum, p) => {
      const s = String(p.status || "").toUpperCase();
      return s === "PAID" ? sum + (p.amountCents || 0) : sum;
    }, 0);
  }, [driverUi]);

  const m = membershipUi(meMembership);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-10">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Account billing</h1>
          <p className="text-sm text-slate-600">
            Ride payments, saved cards, membership charges, and driver earnings.
          </p>
        </header>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Loading billing data…</p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700 shadow-sm">
            <p className="text-sm font-medium">Could not load billing</p>
            <p className="mt-1 text-sm">{error}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => router.refresh()}
                className="rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
              >
                Reload
              </button>
              <Link
                href="/"
                className="rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
              >
                Back home
              </Link>
            </div>
          </div>
        ) : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Membership</h2>
                  <p className="mt-1 text-sm text-slate-600">Status: {badge(m.tone, m.label)}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    If your membership is expired, you won’t be able to request rides until you activate a plan.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link
                    href="/billing/membership"
                    className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {m.cta}
                  </Link>

                  <Link
                    href="/account/billing/payment-method"
                    className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Manage cards
                  </Link>
                </div>
              </div>
            </section>

            {(showRider || showBothSections) && (
              <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Ride payments</h2>
                  <p className="text-xs text-slate-500">Your recent ride charges.</p>
                </div>

                <div className="grid gap-3 lg:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Rides shown</p>
                    <p className="mt-2 text-xl font-semibold text-slate-900">{riderSummary.count}</p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total amount</p>
                    <p className="mt-2 text-xl font-semibold text-slate-900">
                      {money(riderSummary.totalAmountCents, "USD")}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Average ride</p>
                    <p className="mt-2 text-xl font-semibold text-slate-900">
                      {riderSummary.count > 0
                        ? money(Math.round(riderSummary.totalAmountCents / riderSummary.count), "USD")
                        : money(0, "USD")}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Filter scope</p>
                    <p className="mt-2 text-sm font-medium text-slate-900">
                      {range === "today"
                        ? "Today"
                        : range === "yesterday"
                        ? "Yesterday"
                        : range === "7d"
                        ? "Last 7 days"
                        : range === "30d"
                        ? "Last 30 days"
                        : range === "this_month"
                        ? "This month"
                        : range === "custom"
                        ? "Custom"
                        : "All time"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Date range
                    </label>
                    <select
                      value={range}
                      onChange={(e) => setRange(e.target.value as RiderRange)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="today">Today</option>
                      <option value="yesterday">Yesterday</option>
                      <option value="7d">Last 7 days</option>
                      <option value="30d">Last 30 days</option>
                      <option value="this_month">This month</option>
                      <option value="all">All time</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Status
                    </label>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as RiderStatusFilter)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="all">All</option>
                      <option value="succeeded">Succeeded</option>
                      <option value="completed">Completed</option>
                      <option value="failed">Failed</option>
                      <option value="refunded">Refunded</option>
                      <option value="pending">Pending</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Method
                    </label>
                    <select
                      value={methodFilter}
                      onChange={(e) => setMethodFilter(e.target.value as RiderMethodFilter)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="all">All</option>
                      <option value="card">Card</option>
                      <option value="cash">Cash</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Search route
                    </label>
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="City, route, last4..."
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => {
                        setRange("30d");
                        setStatusFilter("all");
                        setMethodFilter("all");
                        setQ("");
                        setFrom(yyyyMmDd(new Date(new Date().setDate(new Date().getDate() - 29))));
                        setTo(yyyyMmDd(new Date()));
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Reset filters
                    </button>
                  </div>
                </div>

                {range === "custom" ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        From
                      </label>
                      <input
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        To
                      </label>
                      <input
                        type="date"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                ) : null}

                {visibleRiderPayments.length === 0 ? (
                  <p className="text-sm text-slate-500">No ride payments match the current filters.</p>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="overflow-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                          <tr>
                            <th className="px-4 py-2 text-left">Date</th>
                            <th className="px-4 py-2 text-left">Route</th>
                            <th className="px-4 py-2 text-left">Status</th>
                            <th className="px-4 py-2 text-left">Method</th>
                            <th className="px-4 py-2 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleRiderPayments.map((p) => (
                            <tr key={p.id} className="border-t border-slate-100">
                              <td className="px-4 py-2 text-slate-700">
                                {new Date(p.createdAt).toLocaleDateString()}
                              </td>
                              <td className="px-4 py-2 text-slate-700">{riderRouteLabel(p)}</td>
                              <td className="px-4 py-2">{statusPill(p.status)}</td>
                              <td className="px-4 py-2 text-slate-700">{methodLabel(p)}</td>
                              <td className="px-4 py-2 text-right font-medium text-slate-900">
                                {money(p.amountCents, p.currency)}
                              </td>
                            </tr>
                          ))}

                          <tr className="border-t-2 border-slate-200 bg-slate-50">
                            <td className="px-4 py-3 text-slate-500" colSpan={4}>
                              <span className="font-semibold text-slate-800">Total</span>
                              <span className="ml-2 text-xs">
                                ({riderSummary.count} {riderSummary.count === 1 ? "ride" : "rides"})
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-900">
                              {money(riderSummary.totalAmountCents, "USD")}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>
            )}

            {(showDriver || showBothSections) && (
              <>
                <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Driver earnings</h2>
                    <p className="text-xs text-slate-500">
                      Platform fees, your earned amount, and payout status.
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Platform fees
                      </p>
                      <p className="mt-2 text-xl font-semibold text-slate-900">
                        {money(filteredDriverSummary.serviceFeeCents, "USD")}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {filteredDriverSummary.rideCount
                          ? `From ${filteredDriverSummary.rideCount} rides`
                          : "No ride transactions yet"}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Your earnings
                      </p>
                      <p className="mt-2 text-xl font-semibold text-slate-900">
                        {money(filteredDriverSummary.netAmountCents, "USD")}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">Net of platform fees</p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Available to payout
                      </p>
                      <p className="mt-2 text-xl font-semibold text-slate-900">
                        {money(filteredDriverSummary.pendingNetAmountCents, "USD")}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Excludes true cash rides already paid directly
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Paid out
                      </p>
                      <p className="mt-2 text-xl font-semibold text-slate-900">
                        {money(totalPaidOut, "USD")}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {driverUi?.payouts.length
                          ? `${driverUi.payouts.length} payout records`
                          : "No payout records yet"}
                      </p>
                    </div>
                  </div>
                </section>

                <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Ride earnings</h2>
                    <p className="text-xs text-slate-500">
                      Gross fare, platform fee, your net earnings, and settlement method.
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        Date range
                      </label>
                      <select
                        value={driverRange}
                        onChange={(e) => setDriverRange(e.target.value as DriverRange)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="today">Today</option>
                        <option value="yesterday">Yesterday</option>
                        <option value="7d">Last 7 days</option>
                        <option value="30d">Last 30 days</option>
                        <option value="this_month">This month</option>
                        <option value="all">All time</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        Status
                      </label>
                      <select
                        value={driverStatusFilter}
                        onChange={(e) => setDriverStatusFilter(e.target.value as DriverStatusFilter)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="all">All</option>
                        <option value="completed">Completed</option>
                        <option value="pending">Pending</option>
                        <option value="failed">Failed</option>
                        <option value="paid">Paid</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        Method
                      </label>
                      <select
                        value={driverMethodFilter}
                        onChange={(e) => setDriverMethodFilter(e.target.value as DriverMethodFilter)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="all">All</option>
                        <option value="card">Card</option>
                        <option value="cash">Cash</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        Search route
                      </label>
                      <input
                        value={driverQ}
                        onChange={(e) => setDriverQ(e.target.value)}
                        placeholder="City, route, ride id..."
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>

                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => {
                          setDriverRange("30d");
                          setDriverStatusFilter("all");
                          setDriverMethodFilter("all");
                          setDriverQ("");
                          setDriverFrom(
                            yyyyMmDd(new Date(new Date().setDate(new Date().getDate() - 29)))
                          );
                          setDriverTo(yyyyMmDd(new Date()));
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Reset filters
                      </button>
                    </div>
                  </div>

                  {driverRange === "custom" ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                          From
                        </label>
                        <input
                          type="date"
                          value={driverFrom}
                          onChange={(e) => setDriverFrom(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                          To
                        </label>
                        <input
                          type="date"
                          value={driverTo}
                          onChange={(e) => setDriverTo(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  ) : null}

                  {!driverUi || visibleDriverTransactions.length === 0 ? (
                    <p className="text-sm text-slate-500">No ride earnings match the current filters.</p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <div className="overflow-auto">
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                            <tr>
                              <th className="px-4 py-2 text-left">Date</th>
                              <th className="px-4 py-2 text-left">Route</th>
                              <th className="px-4 py-2 text-left">Status</th>
                              <th className="px-4 py-2 text-left">Method</th>
                              <th className="px-4 py-2 text-left">Settlement</th>
                              <th className="px-4 py-2 text-right">Gross</th>
                              <th className="px-4 py-2 text-right">Fee</th>
                              <th className="px-4 py-2 text-right">Your earnings</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleDriverTransactions.map((t) => (
                              <tr key={t.id} className="border-t border-slate-100">
                                <td className="px-4 py-2 text-slate-700">
                                  {new Date(t.createdAt).toLocaleDateString()}
                                </td>
                                <td className="px-4 py-2 text-slate-700">{driverRouteLabel(t)}</td>
                                <td className="px-4 py-2">{statusPill(t.status)}</td>
                                <td className="px-4 py-2 text-slate-700">{driverMethodLabel(t)}</td>
                                <td className="px-4 py-2">
                                  {t.payoutEligible
                                    ? smallPill("good", payoutEligibilityLabel(t))
                                    : smallPill("muted", payoutEligibilityLabel(t))}
                                </td>
                                <td className="px-4 py-2 text-right font-medium text-slate-900">
                                  {money(t.grossAmountCents, "USD")}
                                </td>
                                <td className="px-4 py-2 text-right text-slate-700">
                                  {money(t.serviceFeeCents, "USD")}
                                </td>
                                <td className="px-4 py-2 text-right font-medium text-slate-900">
                                  {money(t.netAmountCents, "USD")}
                                </td>
                              </tr>
                            ))}

                            <tr className="border-t-2 border-slate-200 bg-slate-50">
                              <td className="px-4 py-3 text-slate-500" colSpan={5}>
                                <span className="font-semibold text-slate-800">Total</span>
                                <span className="ml-2 text-xs">
                                  ({filteredDriverSummary.rideCount}{" "}
                                  {filteredDriverSummary.rideCount === 1 ? "ride" : "rides"})
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                {money(filteredDriverSummary.grossAmountCents, "USD")}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                {money(filteredDriverSummary.serviceFeeCents, "USD")}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                {money(filteredDriverSummary.netAmountCents, "USD")}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>

                <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Payout history</h2>
                    <p className="text-xs text-slate-500">
                      Actual amounts paid out to the driver.
                    </p>
                  </div>

                  {!driverUi || driverUi.payouts.length === 0 ? (
                    <p className="text-sm text-slate-500">No payout records yet.</p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-slate-200">
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
                            {driverUi.payouts.map((p) => (
                              <tr key={p.id} className="border-t border-slate-100">
                                <td className="px-4 py-2 text-slate-700">
                                  {new Date(p.createdAt).toLocaleDateString()}
                                </td>
                                <td className="px-4 py-2">{statusPill(p.status)}</td>
                                <td className="px-4 py-2 text-right font-medium text-slate-900">
                                  {money(p.amountCents, p.currency)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>

                <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Membership charges</h2>
                    <p className="text-xs text-slate-500">Your membership billing history.</p>
                  </div>

                  {!driverUi || driverUi.membershipCharges.length === 0 ? (
                    <p className="text-sm text-slate-500">No membership charges yet.</p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-slate-200">
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
                            {driverUi.membershipCharges.map((c) => (
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
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}