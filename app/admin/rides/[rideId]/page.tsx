// app/admin/rides/[rideId]/page.tsx
"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type ApiGetResponse =
  | { ok: true; ride: any }
  | { ok: false; error: string };

type ApiActionResponse =
  | { ok: true; ride: any }
  | { ok: false; error: string };

type TimelineItem = { label: string; value: string };

const PLATFORM_FEE_BPS = 1000; // 10%

function dt(s: string | null | undefined) {
  if (!s) return "-";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleString();
}

function money(cents: number | null | undefined) {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "-";
  return `$${(cents / 100).toFixed(2)}`;
}

function yn(v: any) {
  return v ? "Yes" : "No";
}

function cents(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

function computeDriverSplit(grossAmountCents: number) {
  const gross = cents(grossAmountCents);
  const fee = Math.round(gross * (PLATFORM_FEE_BPS / 10000));
  const net = Math.max(0, gross - fee);

  return {
    grossAmountCents: gross,
    platformFeeCents: fee,
    driverNetCents: net,
  };
}

function buildPaymentTimeline(b: any): TimelineItem[] {
  if (!b) return [{ label: "Booking", value: "No booking found" }];

  const items: TimelineItem[] = [];

  const original = b.originalPaymentType ?? "-";
  const current = b.paymentType ?? "-";

  items.push({ label: "Original payment selection", value: String(original) });
  items.push({ label: "Current payment type", value: String(current) });

  const obps = typeof b.originalCashDiscountBps === "number" ? b.originalCashDiscountBps : null;
  const cbps = typeof b.cashDiscountBps === "number" ? b.cashDiscountBps : null;

  if (obps != null) {
    items.push({
      label: "Original cash discount",
      value: `${(obps / 100).toFixed(2)}%`,
    });
  }

  if (cbps != null) {
    items.push({
      label: "Current cash discount",
      value: `${(cbps / 100).toFixed(2)}%`,
    });
  }

  items.push({ label: "Base amount", value: money(b.baseAmountCents) });
  items.push({ label: "Discount", value: money(b.discountCents) });
  items.push({ label: "Final amount", value: money(b.finalAmountCents) });

  items.push({ label: "Cash not paid at", value: dt(b.cashNotPaidAt) });

  const reporter =
    b.cashNotPaidReportedBy?.email ??
    b.cashNotPaidReportedBy?.name ??
    b.cashNotPaidReportedById ??
    b.cashNotPaidByUserId ??
    "-";

  items.push({ label: "Cash not paid reported by", value: String(reporter) });
  items.push({
    label: "Driver/Admin note",
    value: b.cashNotPaidNote ? String(b.cashNotPaidNote) : "-",
  });

  items.push({ label: "Cash discount revoked at", value: dt(b.cashDiscountRevokedAt) });
  items.push({
    label: "Cash discount revoked reason",
    value: b.cashDiscountRevokedReason ? String(b.cashDiscountRevokedReason) : "-",
  });

  items.push({ label: "Fallback card charged at", value: dt(b.fallbackCardChargedAt) });
  items.push({
    label: "Stripe PaymentIntent",
    value: b.stripePaymentIntentId ? String(b.stripePaymentIntentId) : "-",
  });
  items.push({
    label: "Stripe PI status",
    value: b.stripePaymentIntentStatus ? String(b.stripePaymentIntentStatus) : "-",
  });

  items.push({ label: "Booking created", value: dt(b.createdAt) });
  items.push({ label: "Booking updated", value: dt(b.updatedAt) });

  return items;
}

export default function AdminRideDetailPage() {
  const router = useRouter();
  const params = useParams();

  const rideId = useMemo(() => {
    const raw = (params as any)?.rideId;
    return typeof raw === "string" ? decodeURIComponent(raw) : "";
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ride, setRide] = useState<any>(null);

  async function load() {
    if (!rideId) return;

    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/admin/rides/${encodeURIComponent(rideId)}`, {
        cache: "no-store",
      });

      const data = (await res.json().catch(() => null)) as ApiGetResponse | null;
      if (!res.ok || !data || !("ok" in data) || !data.ok) {
        throw new Error((data as any)?.error || `Failed (HTTP ${res.status})`);
      }

      setRide(data.ride);
    } catch (e: any) {
      setError(e?.message || "Failed to load ride.");
      setRide(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!rideId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId]);

  async function adminAction(
    action: "MARK_CASH_NOT_PAID" | "REVOKE_CASH_DISCOUNT" | "CHARGE_FALLBACK_CARD"
  ) {
    if (!rideId) return;

    try {
      setActing(true);
      setError(null);

      const res = await fetch(`/api/admin/rides/${encodeURIComponent(rideId)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action }),
      });

      const data = (await res.json().catch(() => null)) as ApiActionResponse | null;
      if (!res.ok || !data || !("ok" in data) || !data.ok) {
        throw new Error((data as any)?.error || `Action failed (HTTP ${res.status})`);
      }

      setRide(data.ride);
    } catch (e: any) {
      setError(e?.message || "Action failed.");
    } finally {
      setActing(false);
    }
  }

  if (!rideId) {
    return (
      <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
        <div className="mx-auto max-w-4xl px-4 py-10">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700 shadow-sm">
            Missing rideId.
          </div>
        </div>
      </main>
    );
  }

  const b = ride?.latestBooking ?? null;
  const timeline = buildPaymentTimeline(b);

  const dispute = ride?.latestRefundedDispute ?? ride?.dispute ?? null;

  const originallyCash = (b?.originalPaymentType ?? b?.paymentType) === "CASH";
  const hasCashIssue = Boolean(b?.cashNotPaidAt);
  const revoked = Boolean(b?.cashDiscountRevokedAt);
  const charged = Boolean(b?.fallbackCardChargedAt);

  const originalFallbackChargeCents = cents(b?.finalAmountCents);
  const refundAmountCents = Math.min(cents(dispute?.refundAmountCents), originalFallbackChargeCents);
  const refundedAfterDispute = Boolean(dispute?.refundIssued && refundAmountCents > 0);
  const netCardResultCents = Math.max(0, originalFallbackChargeCents - refundAmountCents);

  const originalDriverSplit = computeDriverSplit(originalFallbackChargeCents);

  // Business view:
  // if rider actually paid cash and admin refunded the fallback card charge,
  // the platform should still see its fee on the ride value, and the driver
  // should still be treated as having received the cash fare minus platform fee.
  const adjustedDriverSplit =
    refundedAfterDispute && originallyCash
      ? originalDriverSplit
      : computeDriverSplit(netCardResultCents);

  const effectiveSettlementLabel =
    refundedAfterDispute && originallyCash
      ? "Cash ride preserved; fallback card reversed"
      : netCardResultCents > 0
        ? "Card result retained"
        : "No remaining card proceeds";

  const showAdminActions = originallyCash && (!charged || (!revoked && hasCashIssue));

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-10">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Back
          </button>

          <button
            type="button"
            onClick={load}
            className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            disabled={loading}
            title="Reload"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">Loading…</div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700 shadow-sm">
            {error}
          </div>
        ) : !ride ? null : (
          <>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h1 className="text-xl font-semibold text-slate-900">Ride {ride.id}</h1>
              <p className="mt-1 text-sm text-slate-600">
                {ride.originCity} → {ride.destinationCity}
              </p>

              <div className="mt-4 grid gap-2 text-sm">
                <div><b>Status:</b> {ride.status}</div>
                <div><b>Departure:</b> {dt(ride.departureTime)}</div>
                <div><b>Trip started:</b> {dt(ride.tripStartedAt)}</div>
                <div><b>Trip completed:</b> {dt(ride.tripCompletedAt)}</div>
                <div><b>Created:</b> {dt(ride.createdAt)}</div>
                <div><b>Updated:</b> {dt(ride.updatedAt)}</div>
                <div><b>Distance:</b> {ride.distanceMiles ?? "-"}</div>
                <div><b>Passengers:</b> {ride.passengerCount ?? "-"}</div>
                <div><b>Total (estimate):</b> {money(ride.totalPriceCents)}</div>
                <div><b>Rider:</b> {ride.rider?.email ?? ride.rider?.name ?? "-"}</div>
                <div><b>Driver:</b> {ride.driver?.email ?? ride.driver?.name ?? "-"}</div>
              </div>

              <h2 className="mt-6 text-sm font-semibold text-slate-900">Payment timeline</h2>
              <div className="mt-2 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="grid gap-2 text-sm">
                  {timeline.map((t, idx) => (
                    <div key={`${t.label}-${idx}`} className="flex flex-wrap gap-2">
                      <span className="w-[220px] text-slate-600">{t.label}</span>
                      <span className="font-medium text-slate-900">{t.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-900">
                <h2 className="text-sm font-semibold text-slate-900">Platform accounting view</h2>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div><b>Original fallback charge:</b> {money(originalFallbackChargeCents)}</div>
                  <div><b>Platform fee on ride value:</b> {money(originalDriverSplit.platformFeeCents)}</div>
                  <div><b>Driver net before refund:</b> {money(originalDriverSplit.driverNetCents)}</div>
                  <div><b>Net card result:</b> {money(netCardResultCents)}</div>
                </div>

                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span>Original fare / fallback charge</span>
                    <span className="font-semibold">{money(originalFallbackChargeCents)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span>Platform fee (10%)</span>
                    <span className="font-semibold">-{money(originalDriverSplit.platformFeeCents)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span>Driver net before refund</span>
                    <span className="font-semibold">{money(originalDriverSplit.driverNetCents)}</span>
                  </div>

                  {refundedAfterDispute ? (
                    <div className="mt-1 flex items-center justify-between">
                      <span>Refund to rider card</span>
                      <span className="font-semibold">-{money(refundAmountCents)}</span>
                    </div>
                  ) : null}

                  <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
                    <span className="font-semibold">Effective settlement view</span>
                    <span className="font-semibold">{effectiveSettlementLabel}</span>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                    Driver payout effect
                  </p>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div><b>Original driver earnings:</b> {money(originalDriverSplit.driverNetCents)}</div>
                    <div><b>Adjusted driver earnings:</b> {money(adjustedDriverSplit.driverNetCents)}</div>
                    <div><b>Original platform fee:</b> {money(originalDriverSplit.platformFeeCents)}</div>
                    <div><b>Adjusted platform fee:</b> {money(adjustedDriverSplit.platformFeeCents)}</div>
                  </div>

                  {refundedAfterDispute && originallyCash ? (
                    <p className="mt-3 text-xs text-slate-600">
                      Rider-favored dispute refunded the fallback card charge, but the ride is still
                      treated as cash-paid for platform fee purposes. Driver kept the cash payment,
                      so platform fee remains due on the ride value.
                    </p>
                  ) : refundedAfterDispute ? (
                    <p className="mt-3 text-xs text-slate-600">
                      Refund reduced remaining card proceeds, so driver payout and platform fee are
                      shown against the reduced card result.
                    </p>
                  ) : null}
                </div>
              </div>

              {refundedAfterDispute ? (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
                  <h2 className="text-sm font-semibold text-emerald-900">Refund after dispute</h2>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div><b>Dispute ID:</b> {dispute?.id ?? "-"}</div>
                    <div><b>Dispute status:</b> {dispute?.status ?? "-"}</div>
                    <div><b>Refund recorded:</b> Yes</div>
                    <div><b>Refund amount:</b> -{money(refundAmountCents)}</div>
                    <div><b>Refund issued at:</b> {dt(dispute?.refundIssuedAt)}</div>
                    <div><b>Resolved at:</b> {dt(dispute?.resolvedAt)}</div>
                  </div>

                  <div className="mt-3 rounded-xl border border-emerald-200 bg-white/80 p-3">
                    <div className="flex items-center justify-between">
                      <span>Original fallback charge</span>
                      <span className="font-semibold">{money(originalFallbackChargeCents)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span>Refund after dispute</span>
                      <span className="font-semibold">-{money(refundAmountCents)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between border-t border-emerald-200 pt-2">
                      <span className="font-semibold">Net card result</span>
                      <span className="font-semibold">{money(netCardResultCents)}</span>
                    </div>
                  </div>

                  {dispute?.adminNotes ? (
                    <div className="mt-3 rounded-xl border border-emerald-200 bg-white/80 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                        Admin notes
                      </p>
                      <p className="mt-1 whitespace-pre-wrap">{String(dispute.adminNotes)}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-slate-800">
                  Latest booking (raw)
                </summary>
                <pre className="mt-2 overflow-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-100">
{JSON.stringify(ride.latestBooking, null, 2)}
                </pre>
              </details>
            </div>

            {showAdminActions ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">Admin actions</h2>
                <p className="mt-1 text-sm text-slate-600">
                  These are rarely used. Normally the driver reports a cash refusal, then an admin
                  confirms or reconciles.
                </p>

                <div className="mt-3 grid gap-2 text-sm text-slate-700">
                  <div><b>Originally CASH:</b> {yn(originallyCash)}</div>
                  <div><b>Cash not paid reported:</b> {yn(hasCashIssue)}</div>
                  <div><b>Discount revoked:</b> {yn(revoked)}</div>
                  <div><b>Fallback card charged:</b> {yn(charged)}</div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={acting || hasCashIssue}
                    onClick={() => adminAction("MARK_CASH_NOT_PAID")}
                    className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Mark cash not paid
                  </button>

                  <button
                    type="button"
                    disabled={acting || revoked}
                    onClick={() => adminAction("REVOKE_CASH_DISCOUNT")}
                    className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Revoke cash discount
                  </button>

                  <button
                    type="button"
                    disabled={acting || charged}
                    onClick={() => adminAction("CHARGE_FALLBACK_CARD")}
                    className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    Charge fallback card
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
