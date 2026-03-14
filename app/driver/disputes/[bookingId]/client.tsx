// OATH: Clean replacement file
// FILE: app/driver/disputes/[bookingId]/client.tsx

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type DriverDisputeView =
  | {
      ok: true;
      booking: {
        id: string;
        paymentType: string | null;
        cashNotPaidAt: string | null;
        fallbackCardChargedAt: string | null;
        cashNotPaidReason: string | null;
        cashNotPaidNote: string | null;
        baseAmountCents: number | null;
        finalAmountCents: number | null;
        currency: string | null;
      };
      ride: {
        id: string;
        originCity: string;
        destinationCity: string;
        departureTime: string;
        tripCompletedAt: string | null;
        status: string;
        riderName: string | null;
        driverName: string | null;
      };
      dispute: {
        id: string;
        status: string;
        reason: string | null;
        riderStatement: string | null;
        createdAt: string;
      } | null;
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

function riderReasonLabel(v: string | null | undefined) {
  if (v === "CASH_ALREADY_PAID") return "Rider says cash was already paid";
  if (v === "UNAUTHORIZED_FALLBACK_CHARGE") {
    return "Rider says fallback card charge was unauthorized";
  }
  if (v === "OTHER") return "Other";
  return "Not submitted";
}

function disputeStatusLabel(v: string | null | undefined) {
  if (!v) return "No dispute submitted";
  if (v === "OPEN") return "Open";
  if (v === "UNDER_REVIEW") return "Under review";
  if (v === "RESOLVED_RIDER") return "Resolved in rider's favor";
  if (v === "RESOLVED_DRIVER") return "Resolved in driver's favor";
  if (v === "CLOSED") return "Closed";
  return v;
}

export default function DriverDisputeDetailPageClient() {
  const params = useParams();

  const bookingId = useMemo(() => {
    const raw = params?.bookingId;
    return typeof raw === "string" ? raw.trim() : "";
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DriverDisputeView | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!bookingId) {
        setData({ ok: false, error: "Missing bookingId" });
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

        const res = await fetch(
          `/api/driver/disputes/details?bookingId=${encodeURIComponent(bookingId)}`,
          { cache: "no-store" }
        );

        const json = (await res.json().catch(() => null)) as DriverDisputeView | null;

        if (!res.ok || !json) {
          throw new Error("Failed to load dispute details.");
        }

        if (json.ok === false) {
          throw new Error(json.error || "Failed to load dispute details.");
        }

        if (!cancelled) {
          setData(json);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setData({
            ok: false,
            error:
              err instanceof Error
                ? err.message
                : "Failed to load dispute details.",
          });
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
  }, [bookingId]);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Dispute review
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Review the rider's submitted dispute for this fallback charge.
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
            <p className="text-sm text-slate-500">Loading dispute details…</p>
          </section>
        ) : !data || !data.ok ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
            <p className="text-sm font-medium text-rose-700">
              Could not load dispute details
            </p>
            <p className="mt-1 text-sm text-rose-700">
              {data && !data.ok ? data.error : "Unknown error"}
            </p>
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">
                Charge details
              </h2>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Route
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {data.ride.originCity} → {data.ride.destinationCity}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Charged amount
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {money(data.booking.finalAmountCents, data.booking.currency)}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Rider
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {data.ride.riderName || "Unknown"}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Reported reason
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {driverReasonLabel(data.booking.cashNotPaidReason)}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Driver note
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {data.booking.cashNotPaidNote || "No note provided"}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Fallback charged at
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {data.booking.fallbackCardChargedAt
                      ? new Date(data.booking.fallbackCardChargedAt).toLocaleString()
                      : "Unknown"}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">
                Rider dispute
              </h2>

              {!data.dispute ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  No dispute has been submitted for this charge.
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Submitted reason
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      {riderReasonLabel(data.dispute.reason)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Rider statement
                    </p>
                    <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                      {data.dispute.riderStatement || "No statement provided"}
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Status
                      </p>
                      <p className="mt-1 text-sm text-slate-700">
                        {disputeStatusLabel(data.dispute.status)}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Submitted at
                      </p>
                      <p className="mt-1 text-sm text-slate-700">
                        {new Date(data.dispute.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
