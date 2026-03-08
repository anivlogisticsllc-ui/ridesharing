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

type DriverTransaction = {
  id: string;
  rideId: string;
  createdAt: string;
  status: string;
  grossAmountCents: number;
  serviceFeeCents: number;
  netAmountCents: number;
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
      payouts: any[];
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
      : "bg-slate-50 text-slate-700 ring-1 ring-slate-200";

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {s || "—"}
    </span>
  );
}

export default function DriverPaymentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DriverBillingApi | null>(null);

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace(`${ROUTES.login}?callbackUrl=${encodeURIComponent("/driver/payments")}`);
      return;
    }

    const role = (session.user as any)?.role as string | undefined;
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
          throw new Error((json as any)?.error || "Failed to load driver payments");
        }

        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load driver payments");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [session, status, router]);

  const summary = useMemo(() => {
    if (!data || !data.ok) return null;
    return data.earningsSummary;
  }, [data]);

  if (status === "loading" || loading) {
    return <p className="py-10 text-center text-slate-600">Loading…</p>;
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-6xl space-y-6">
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

        {summary ? (
          <section className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Gross rides</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {money(summary.grossAmountCents)}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Platform fee</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {money(summary.serviceFeeCents)}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Driver net</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {money(summary.netAmountCents)}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Pending payout</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {money(summary.pendingNetAmountCents)}
              </div>
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Ride earnings</h2>
          <p className="mt-1 text-xs text-slate-500">
            Gross fare, platform fee (10%), and your net earnings.
          </p>

          {!data || !data.ok || data.transactions.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No driver transactions yet.</p>
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-left">Route</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-right">Gross</th>
                      <th className="px-4 py-2 text-right">Fee</th>
                      <th className="px-4 py-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.transactions.map((t) => (
                      <tr key={t.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 text-slate-700">
                          {new Date(t.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2 text-slate-700">{routeLabel(t)}</td>
                        <td className="px-4 py-2">{statusPill(t.status)}</td>
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