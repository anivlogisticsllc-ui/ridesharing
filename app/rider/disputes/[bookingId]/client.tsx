"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type DisputeReason =
  | "CASH_ALREADY_PAID"
  | "UNAUTHORIZED_FALLBACK_CHARGE"
  | "OTHER";

type ChargeView =
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
        driverName: string | null;
      };
      dispute?: {
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

type CreateResponse =
  | {
      ok: true;
      dispute: {
        id: string;
        status: string;
        bookingId: string;
        rideId: string;
        reason: string;
        createdAt: string;
      };
    }
  | { ok: false; error: string };

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
  if (v === "CASH_ALREADY_PAID") return "I already paid cash to the driver";
  if (v === "UNAUTHORIZED_FALLBACK_CHARGE") {
    return "This fallback card charge is unauthorized";
  }
  return "Not specified";
}

export default function RiderDisputeDetailPageClient() {
  const router = useRouter();
  const params = useParams();

  const bookingId = useMemo(() => {
    const raw = params?.bookingId;
    return typeof raw === "string" ? raw.trim() : "";
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [charge, setCharge] = useState<ChargeView | null>(null);

  const [reason, setReason] = useState<DisputeReason>("CASH_ALREADY_PAID");
  const [statement, setStatement] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!bookingId) {
        setCharge({ ok: false, error: "Missing bookingId" });
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

        const res = await fetch(
          `/api/rider/disputes/details?bookingId=${encodeURIComponent(bookingId)}`,
          { cache: "no-store" }
        );

        const json = (await res.json().catch(() => null)) as ChargeView | null;

        if (!res.ok || !json) {
          throw new Error("Failed to load dispute details.");
        }

        if (json.ok === false) {
          throw new Error(json.error || "Failed to load dispute details.");
        }

        if (!cancelled) {
          setCharge(json);

          if (
            json.dispute?.reason === "CASH_ALREADY_PAID" ||
            json.dispute?.reason === "UNAUTHORIZED_FALLBACK_CHARGE" ||
            json.dispute?.reason === "OTHER"
          ) {
            setReason(json.dispute.reason);
          }

          if (json.dispute?.riderStatement) {
            setStatement(json.dispute.riderStatement);
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setCharge({
            ok: false,
            error:
              err instanceof Error
                ? err.message
                : "Failed to load dispute context.",
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

  const alreadySubmitted = !!(charge && charge.ok && charge.dispute);

  const canSubmit = useMemo(() => {
    return (
      bookingId.length > 0 &&
      statement.trim().length >= 10 &&
      !submitting &&
      !alreadySubmitted
    );
  }, [bookingId, statement, submitting, alreadySubmitted]);

  async function handleSubmit() {
    if (!canSubmit) return;

    try {
      setSubmitting(true);
      setSubmitError(null);
      setSubmitSuccess(null);

      const res = await fetch("/api/rider/disputes/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId,
          reason,
          riderStatement: statement.trim(),
        }),
      });

      const json = (await res.json().catch(() => null)) as CreateResponse | null;

      if (!res.ok || !json) {
        throw new Error("Failed to submit dispute.");
      }

      if (json.ok === false) {
        throw new Error(json.error || "Failed to submit dispute.");
      }

      setSubmitSuccess("Dispute submitted successfully.");

      window.setTimeout(() => {
        router.refresh();
      }, 1200);
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to submit dispute."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Dispute fallback card charge
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Review this case and submit your response if the fallback charge is incorrect.
            </p>
          </div>

          <Link
            href="/rider/disputes"
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back
          </Link>
        </div>

        {loading ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Loading charge details…</p>
          </section>
        ) : !charge || !charge.ok ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
            <p className="text-sm font-medium text-rose-700">
              Could not load dispute details
            </p>
            <p className="mt-1 text-sm text-rose-700">
              {charge && !charge.ok ? charge.error : "Unknown error"}
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
                    {charge.ride.originCity} → {charge.ride.destinationCity}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Charged amount
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {money(charge.booking.finalAmountCents, charge.booking.currency)}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Driver
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {charge.ride.driverName || "Unknown"}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Reported reason
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {reasonLabel(charge.booking.cashNotPaidReason)}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Driver note
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {charge.booking.cashNotPaidNote || "No note provided"}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Fallback charged at
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {charge.booking.fallbackCardChargedAt
                      ? new Date(charge.booking.fallbackCardChargedAt).toLocaleString()
                      : "Unknown"}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">
                Your dispute
              </h2>

              {alreadySubmitted ? (
                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Submitted reason
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      {reasonLabel(charge.dispute?.reason)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Your statement
                    </p>
                    <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                      {charge.dispute?.riderStatement || "No statement provided"}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Status
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      {charge.dispute?.status || "Submitted"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Dispute reason
                    </label>
                    <select
                      value={reason}
                      onChange={(e) => setReason(e.target.value as DisputeReason)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="CASH_ALREADY_PAID">
                        I already paid cash to the driver
                      </option>
                      <option value="UNAUTHORIZED_FALLBACK_CHARGE">
                        This fallback card charge is unauthorized
                      </option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Explain what happened
                    </label>
                    <textarea
                      value={statement}
                      onChange={(e) => setStatement(e.target.value)}
                      rows={7}
                      placeholder="Describe why you believe this charge is incorrect. Include any useful details."
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Minimum 10 characters.
                    </p>
                  </div>

                  {submitError ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                      {submitError}
                    </div>
                  ) : null}

                  {submitSuccess ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                      {submitSuccess}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={!canSubmit}
                      className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submitting ? "Submitting…" : "Submit dispute"}
                    </button>

                    <Link
                      href="/rider/disputes"
                      className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </Link>
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
