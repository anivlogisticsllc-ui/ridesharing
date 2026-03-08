// app/driver/payouts/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const ROUTES = {
  login: "/auth/login",
  membership: "/billing/membership",
  driverPortal: "/driver/portal",
  payments: "/driver/payments",
} as const;

type DriverPayout = {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  createdAt: string;
};

type DriverBillingApi =
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
      transactions: any[];
      membershipCharges: any[];
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

function statusPill(status: string) {
  const s = String(status || "").toUpperCase();

  const cls =
    s === "PAID" || s === "COMPLETED" || s === "SUCCEEDED"
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
      : s === "FAILED" || s === "CANCELED" || s === "CANCELLED"
      ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
      : "bg-slate-50 text-slate-700 ring-1 ring-slate-200";

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {s || "—"}
    </span>
  );
}

export default function DriverPayoutsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DriverBillingApi | null>(null);

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace(`${ROUTES.login}?callbackUrl=${encodeURIComponent("/driver/payouts")}`);
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
          throw new Error((json as any)?.error || "Failed to load driver payouts");
        }

        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load driver payouts");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [session, status, router]);

  const payoutSummary = useMemo(() => {
    if (!data || !data.ok) return null;

    const totalPaid = data.payouts
      .filter((p) => String(p.status).toUpperCase() === "PAID")
      .reduce((sum, p) => sum + p.amountCents, 0);

    return {
      availableToPayout: data.earningsSummary.pendingNetAmountCents,
      totalPaid,
      payoutCount: data.payouts.length,
    };
  }, [data]);

  if (status === "loading" || loading) {
    return <p className="py-10 text-center text-slate-600">Loading…</p>;
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Payouts</h1>
          <p className="mt-2 text-sm text-slate-600">
            Your payable balance and payout history.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <Link
              href={ROUTES.payments}
              className="rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              Driver payments
            </Link>

            <Link
              href={ROUTES.membership}
              className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
            >
              Membership billing
            </Link>

            <Link
              href={ROUTES.driverPortal}
              className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
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

        {payoutSummary ? (
          <section className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Available to payout
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {money(payoutSummary.availableToPayout)}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Total paid out
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {money(payoutSummary.totalPaid)}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Payout records
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {payoutSummary.payoutCount}
              </div>
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Payout history</h2>
          <p className="mt-1 text-xs text-slate-500">Completed and pending payout records.</p>

          {!data || !data.ok || data.payouts.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No payout records yet.</p>
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
                    {data.payouts.map((p) => (
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
      </div>
    </main>
  );
}