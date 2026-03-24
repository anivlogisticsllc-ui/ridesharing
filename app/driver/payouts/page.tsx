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

type LedgerSettlementType =
  | "CARD_PAYOUT"
  | "CASH_COLLECTED"
  | "CASH_PRESERVED"
  | "REFUND_ADJUSTED"
  | "UNKNOWN";

type DriverBillingRow = {
  id: string;
  rideId: string;
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

type DriverPayoutWeek = {
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

  rides: DriverBillingRow[];
};

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
      transactions: DriverBillingRow[];
      weeklyPayouts: DriverPayoutWeek[];
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
      membershipCharges: {
        id: string;
        amountCents: number;
        currency: string;
        status: string;
        createdAt: string;
        paidAt: string | null;
        failedAt: string | null;
      }[];
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

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function routeLabel(tx: DriverBillingRow) {
  const from = tx.ride?.originCity?.trim() || "Unknown";
  const to = tx.ride?.destinationCity?.trim() || "Unknown";
  return `${from} → ${to}`;
}

function statusPill(status: string) {
  const s = String(status || "").toUpperCase();

  const cls =
    s === "PAID" || s === "COMPLETED" || s === "SUCCEEDED"
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
      : s === "PENDING"
      ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
      : s === "FAILED" || s === "CANCELED" || s === "CANCELLED" || s === "REFUNDED"
      ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
      : "bg-slate-50 text-slate-700 ring-1 ring-slate-200";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {s || "—"}
    </span>
  );
}

function settlementLabel(value: LedgerSettlementType) {
  switch (value) {
    case "CARD_PAYOUT":
      return "Card payout";
    case "CASH_COLLECTED":
      return "Cash collected";
    case "CASH_PRESERVED":
      return "Cash preserved";
    case "REFUND_ADJUSTED":
      return "Refund adjusted";
    default:
      return "Unknown";
  }
}

function summaryCard(
  title: string,
  value: string,
  subtext?: string
) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {subtext ? <p className="mt-1 text-[11px] text-slate-500">{subtext}</p> : null}
    </div>
  );
}

export default function DriverPayoutsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DriverBillingApi | null>(null);
  const [selectedWeekKey, setSelectedWeekKey] = useState("");

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace(
        `${ROUTES.login}?callbackUrl=${encodeURIComponent("/driver/payouts")}`
      );
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

        const res = await fetch("/api/account/billing/driver", {
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as DriverBillingApi | null;

        if (!res.ok || !json || !("ok" in json) || !json.ok) {
          throw new Error(
            (json as { error?: string } | null)?.error ||
              "Failed to load driver payouts"
          );
        }

        if (!cancelled) {
          setData(json);
          setSelectedWeekKey(
            json.payoutView.defaultWeekKey || json.weeklyPayouts[0]?.key || ""
          );
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Failed to load driver payouts"
          );
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

  const selectedWeek = useMemo(() => {
    if (!data || !data.ok) return null;
    return (
      data.weeklyPayouts.find((w) => w.key === selectedWeekKey) ||
      data.weeklyPayouts[0] ||
      null
    );
  }, [data, selectedWeekKey]);

  const payoutSummary = useMemo(() => {
    if (!data || !data.ok) return null;

    const totalPaid = data.payouts
      .filter((p) => String(p.status || "").toUpperCase() === "PAID")
      .reduce((sum, p) => sum + p.amountCents, 0);

    return {
      availableToPayout: data.earningsSummary.pendingNetAmountCents,
      totalPaid,
      payoutCount: data.payouts.length,
    };
  }, [data]);

  const includedRides = useMemo(() => {
    return selectedWeek?.rides.filter((r) => r.payoutEligible) ?? [];
  }, [selectedWeek]);

  const excludedRides = useMemo(() => {
    return selectedWeek?.rides.filter((r) => !r.payoutEligible) ?? [];
  }, [selectedWeek]);

  if (status === "loading" || loading) {
    return <p className="py-10 text-center text-slate-600">Loading…</p>;
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Payouts</h1>
          <p className="mt-2 text-sm text-slate-600">
            Weekly bank payout view for driver earnings. Cash rides still count as
            earnings, but they do not transfer to bank payout.
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
        </section>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700 shadow-sm">
            {error}
          </div>
        ) : null}

        {payoutSummary ? (
          <section className="grid gap-3 md:grid-cols-3">
            {summaryCard(
              "Available to payout",
              money(payoutSummary.availableToPayout),
              "Current unpaid bank-payable rides only"
            )}

            {summaryCard(
              "Total paid out",
              money(payoutSummary.totalPaid),
              "Paid payout records only"
            )}

            {summaryCard(
              "Payout records",
              String(payoutSummary.payoutCount),
              "Existing payout history"
            )}
          </section>
        ) : null}

        {!data || !data.ok || data.weeklyPayouts.length === 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Weekly payout view</h2>
            <p className="mt-4 text-sm text-slate-500">No payout weeks found yet.</p>
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Weekly payout view
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Default week is the last paid week, or the current unpaid week if
                    no paid batch exists yet.
                  </p>
                </div>

                <div className="w-full md:w-auto">
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Payout week
                  </label>
                  <select
                    value={selectedWeekKey}
                    onChange={(e) => setSelectedWeekKey(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 md:min-w-[360px]"
                  >
                    {data.payoutView.weekOptions.map((w) => (
                      <option key={w.key} value={w.key}>
                        {w.label} • {w.payoutStatus} • bank payout {money(w.includedNetAmountCents)} • included {w.includedRideCount}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            {selectedWeek ? (
              <>
                <section className="grid gap-3 md:grid-cols-4">
                  {summaryCard(
                    "Selected week",
                    selectedWeek.label,
                    `${formatDate(selectedWeek.weekStart)} to ${formatDate(
                      selectedWeek.weekEnd
                    )}`
                  )}

                  {summaryCard(
                    "Bank payout amount",
                    money(selectedWeek.payoutAmountCents),
                    selectedWeek.payoutStatus === "PAID"
                      ? `Paid at ${formatDateTime(selectedWeek.payoutCreatedAt)}`
                      : selectedWeek.payoutStatus === "PENDING"
                      ? "Pending payout record"
                      : "No payout record for this week"
                  )}

                  {summaryCard(
                    "Included rides",
                    String(selectedWeek.includedRideCount),
                    `Net bank payout ${money(selectedWeek.includedNetAmountCents)}`
                  )}

                  {summaryCard(
                    "Excluded rides",
                    String(selectedWeek.excludedRideCount),
                    `Driver still earned ${money(selectedWeek.excludedNetAmountCents)}`
                  )}
                </section>

                <section className="grid gap-3 md:grid-cols-3">
                  {summaryCard(
                    "Included gross",
                    money(selectedWeek.includedGrossAmountCents),
                    "Gross amount from bank-payable rides"
                  )}

                  {summaryCard(
                    "Included platform fee",
                    money(selectedWeek.includedServiceFeeCents),
                    "Platform fee on included rides"
                  )}

                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Payout status
                    </div>
                    <div className="mt-2">{statusPill(selectedWeek.payoutStatus)}</div>
                    <p className="mt-2 text-[11px] text-slate-500">
                      Payout ID: {selectedWeek.payoutId || "—"}
                    </p>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Included rides
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    These rides are eligible to transfer to bank payout for the selected week.
                  </p>

                  {includedRides.length === 0 ? (
                    <p className="mt-4 text-sm text-slate-500">
                      No included rides for this week.
                    </p>
                  ) : (
                    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                      <div className="overflow-auto">
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                            <tr>
                              <th className="px-4 py-2 text-left">Date</th>
                              <th className="px-4 py-2 text-left">Route</th>
                              <th className="px-4 py-2 text-left">Settlement</th>
                              <th className="px-4 py-2 text-left">Status</th>
                              <th className="px-4 py-2 text-right">Gross</th>
                              <th className="px-4 py-2 text-right">Fee</th>
                              <th className="px-4 py-2 text-right">Net</th>
                            </tr>
                          </thead>
                          <tbody>
                            {includedRides.map((tx) => (
                              <tr key={tx.id} className="border-t border-slate-100">
                                <td className="px-4 py-2 text-slate-700">
                                  {formatDate(tx.ride?.departureTime || tx.createdAt)}
                                </td>
                                <td className="px-4 py-2 text-slate-700">
                                  {routeLabel(tx)}
                                </td>
                                <td className="px-4 py-2 text-slate-700">
                                  {settlementLabel(tx.settlementType)}
                                </td>
                                <td className="px-4 py-2">{statusPill(tx.status)}</td>
                                <td className="px-4 py-2 text-right font-medium text-slate-900">
                                  {money(tx.grossAmountCents)}
                                </td>
                                <td className="px-4 py-2 text-right text-slate-700">
                                  {money(tx.serviceFeeCents)}
                                </td>
                                <td className="px-4 py-2 text-right font-medium text-slate-900">
                                  {money(tx.netAmountCents)}
                                </td>
                              </tr>
                            ))}

                            <tr className="border-t-2 border-slate-200 bg-slate-50">
                              <td colSpan={4} className="px-4 py-3 font-semibold text-slate-800">
                                Included totals
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                {money(selectedWeek.includedGrossAmountCents)}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                {money(selectedWeek.includedServiceFeeCents)}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                {money(selectedWeek.includedNetAmountCents)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Excluded rides
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    These rides still count in driver earnings, but they do not transfer to bank payout.
                  </p>

                  {excludedRides.length === 0 ? (
                    <p className="mt-4 text-sm text-slate-500">
                      No excluded rides for this week.
                    </p>
                  ) : (
                    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                      <div className="overflow-auto">
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                            <tr>
                              <th className="px-4 py-2 text-left">Date</th>
                              <th className="px-4 py-2 text-left">Route</th>
                              <th className="px-4 py-2 text-left">Settlement</th>
                              <th className="px-4 py-2 text-left">Reason</th>
                              <th className="px-4 py-2 text-right">Gross</th>
                              <th className="px-4 py-2 text-right">Fee</th>
                              <th className="px-4 py-2 text-right">Net</th>
                            </tr>
                          </thead>
                          <tbody>
                            {excludedRides.map((tx) => (
                              <tr key={tx.id} className="border-t border-slate-100">
                                <td className="px-4 py-2 text-slate-700">
                                  {formatDate(tx.ride?.departureTime || tx.createdAt)}
                                </td>
                                <td className="px-4 py-2 text-slate-700">
                                  {routeLabel(tx)}
                                </td>
                                <td className="px-4 py-2 text-slate-700">
                                  {settlementLabel(tx.settlementType)}
                                </td>
                                <td className="px-4 py-2 text-slate-700">
                                  {tx.exclusionReason || "Not payout eligible"}
                                </td>
                                <td className="px-4 py-2 text-right font-medium text-slate-900">
                                  {money(tx.grossAmountCents)}
                                </td>
                                <td className="px-4 py-2 text-right text-slate-700">
                                  {money(tx.serviceFeeCents)}
                                </td>
                                <td className="px-4 py-2 text-right font-medium text-slate-900">
                                  {money(tx.netAmountCents)}
                                </td>
                              </tr>
                            ))}

                            <tr className="border-t-2 border-slate-200 bg-slate-50">
                              <td colSpan={4} className="px-4 py-3 font-semibold text-slate-800">
                                Excluded totals
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                {money(selectedWeek.excludedGrossAmountCents)}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                {money(selectedWeek.excludedServiceFeeCents)}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                {money(selectedWeek.excludedNetAmountCents)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>
              </>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}