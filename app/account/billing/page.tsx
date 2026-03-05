// app/account/billing/page.tsx
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

type RiderApiResponse =
  | { ok: true; payments: RiderPayment[] }
  | { ok: false; error: string };

type DriverApiResponse =
  | {
      ok: true;
      payouts: DriverPayout[];
      serviceFees?: { totalFeesCents?: number; rideCount?: number };
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

function money(cents: number, currency: string) {
  const c = (currency || "USD").toUpperCase();
  const amount = (Number.isFinite(cents) ? cents : 0) / 100;

  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${c}`;
  }
}

function methodLabel(p: RiderPayment) {
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

function routeLabel(p: RiderPayment) {
  const from = p.ride?.originCity?.trim() || "Unknown";
  const to = p.ride?.destinationCity?.trim() || "Unknown";
  return `${from} → ${to}`;
}

function statusPill(status: string) {
  const s = String(status || "").toUpperCase();
  const isGood = ["SUCCEEDED", "PAID", "COMPLETED"].includes(s);
  const isBad = ["FAILED", "CANCELED", "CANCELLED"].includes(s);

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

function membershipUi(m: MeApiResponse extends { ok: true } ? MeApiResponse["membership"] : any) {
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

export default function AccountBillingPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const role = asRole((session?.user as any)?.role);

  const showRider = role === "RIDER";
  const showDriver = role === "DRIVER" || role === "ADMIN";
  const showBothSections = role === "ADMIN";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [riderPayments, setRiderPayments] = useState<RiderPayment[]>([]);
  const [driverPayouts, setDriverPayouts] = useState<DriverPayout[]>([]);
  const [serviceFeeTotal, setServiceFeeTotal] = useState<number>(0);
  const [serviceFeeCount, setServiceFeeCount] = useState<number>(0);

  const [meMembership, setMeMembership] = useState<MeApiResponse extends { ok: true } ? any : any>(null);

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

        // Membership status (for CTA)
        const meRes = await fetch("/api/auth/me", { cache: "no-store" });
        const meJson = (await meRes.json().catch(() => null)) as MeApiResponse | null;
        if (meRes.ok && meJson && "ok" in meJson && meJson.ok) {
          if (!cancelled) setMeMembership(meJson.membership);
        } else {
          if (!cancelled) setMeMembership(null);
        }

        // Rider payments
        if (showRider || showBothSections) {
          const res = await fetch("/api/account/billing/rider", { cache: "no-store" });
          const json = (await res.json().catch(() => null)) as RiderApiResponse | null;
          if (!res.ok || !json || !("ok" in json) || !json.ok) {
            throw new Error((json as any)?.error || "Failed to load rider billing");
          }
          if (!cancelled) setRiderPayments(json.payments || []);
        } else if (!cancelled) {
          setRiderPayments([]);
        }

        // Driver payouts / fees
        if (showDriver || showBothSections) {
          const res = await fetch("/api/account/billing/driver", { cache: "no-store" });
          const json = (await res.json().catch(() => null)) as DriverApiResponse | null;
          if (!res.ok || !json || !("ok" in json) || !json.ok) {
            throw new Error((json as any)?.error || "Failed to load driver billing");
          }

          if (!cancelled) {
            setDriverPayouts(json.payouts || []);
            setServiceFeeTotal(json.serviceFees?.totalFeesCents ?? 0);
            setServiceFeeCount(json.serviceFees?.rideCount ?? 0);
          }
        } else if (!cancelled) {
          setDriverPayouts([]);
          setServiceFeeTotal(0);
          setServiceFeeCount(0);
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

  const m = membershipUi(meMembership);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">Account billing</h1>
          <p className="text-sm text-slate-600">
            Ride payments, saved cards, service fees, and payouts. Membership is managed separately.
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
            {/* Membership + Cards (top-level actions) */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Membership</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Status: {badge(m.tone, m.label)}
                  </p>
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
              <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Ride payments</h2>
                  <p className="text-xs text-slate-500">Your recent ride charges.</p>
                </div>

                {riderPayments.length === 0 ? (
                  <p className="text-sm text-slate-500">No ride payments yet.</p>
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
                          {riderPayments.map((p) => (
                            <tr key={p.id} className="border-t border-slate-100">
                              <td className="px-4 py-2 text-slate-700">
                                {new Date(p.createdAt).toLocaleDateString()}
                              </td>
                              <td className="px-4 py-2 text-slate-700">{routeLabel(p)}</td>
                              <td className="px-4 py-2">{statusPill(p.status)}</td>
                              <td className="px-4 py-2 text-slate-700">{methodLabel(p)}</td>
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
            )}

            {(showDriver || showBothSections) && (
              <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Driver fees and payouts</h2>
                  <p className="text-xs text-slate-500">Service fees collected and your payouts.</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Service fees</p>
                    <p className="mt-2 text-xl font-semibold text-slate-900">
                      {money(serviceFeeTotal, "USD")}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {serviceFeeCount > 0 ? `From ${serviceFeeCount} transactions` : "No transactions yet"}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Payouts</p>
                    <p className="mt-2 text-xl font-semibold text-slate-900">{driverPayouts.length}</p>
                    <p className="mt-1 text-[11px] text-slate-500">Total payout records</p>
                  </div>
                </div>

                {driverPayouts.length === 0 ? (
                  <p className="text-sm text-slate-500">No payouts yet.</p>
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
                          {driverPayouts.map((p) => (
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
            )}
          </>
        )}
      </div>
    </main>
  );
}