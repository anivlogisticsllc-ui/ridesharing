// OATH: Clean replacement file
// FILE: app/admin/disputes/[disputeId]/client.tsx

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type AuditLogItem = {
  id: string;
  actionType: string;
  targetType: string;
  targetId: string;
  notes: string | null;
  createdAt: string;
  adminUserName: string | null;
};

type AdminDisputeDetailResponse =
  | {
      ok: true;
      dispute: {
        id: string;
        bookingId: string;
        rideId: string;
        status: string;
        reason: string;
        riderStatement: string;
        adminDecision: string | null;
        adminNotes: string | null;
        resolvedAt: string | null;
        createdAt: string;
        refundIssued: boolean;
        refundAmountCents: number | null;
        refundIssuedAt: string | null;
      };
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
        riderEmail?: string | null;
        driverName: string | null;
        driverEmail?: string | null;
      };
      auditLogs?: AuditLogItem[];
    }
  | {
      ok: false;
      error: string;
    };

type UpdateResponse =
  | {
      ok: true;
      dispute: {
        id: string;
        status: string;
        adminDecision: string | null;
        adminNotes: string | null;
        resolvedAt: string | null;
        refundIssued: boolean;
        refundAmountCents: number | null;
        refundIssuedAt: string | null;
      };
    }
  | {
      ok: false;
      error: string;
    };

type SendEmailResponse =
  | {
      ok: true;
      sentTo: string;
      subject: string;
    }
  | {
      ok: false;
      error: string;
    };

type EmailRecipientKind = "RIDER" | "DRIVER" | "CUSTOM";

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

function centsToInput(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(Math.max(0, Math.round(value)));
}

function parseRefundCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;

  return Math.max(0, Math.round(parsed));
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

function auditActionLabel(v: string | null | undefined) {
  if (!v) return "Unknown action";
  if (v === "DISPUTE_MARKED_UNDER_REVIEW") return "Marked under review";
  if (v === "DISPUTE_RESOLVED_RIDER") return "Resolved in rider's favor";
  if (v === "DISPUTE_RESOLVED_DRIVER") return "Resolved in driver's favor";
  if (v === "FALLBACK_CHARGE_REFUNDED") return "Fallback charge refunded";
  if (v === "DRIVER_CASH_BLOCKED_30_DAYS") return "Driver cash rides blocked";
  if (v === "DRIVER_REMOVED_FOR_REPEAT_CASH_FRAUD") {
    return "Driver removed for repeat cash fraud";
  }
  if (v === "DISPUTE_EMAIL_SENT") return "Email sent";
  return v;
}

function buildDefaultSubject(routeLabel: string) {
  return `RideShare dispute update: ${routeLabel}`;
}

function buildDefaultMessage(args: {
  recipientName: string | null | undefined;
  routeLabel: string;
  status: string;
  adminNotes: string;
}) {
  const name = args.recipientName?.trim() || "there";
  const notes = args.adminNotes.trim();

  return [
    `Hello ${name},`,
    "",
    "This is an update regarding the RideShare fallback charge dispute.",
    "",
    `Route: ${args.routeLabel}`,
    `Current status: ${statusLabel(args.status)}`,
    ...(notes ? ["", "Admin notes:", notes] : []),
    "",
    "If you have any supporting details, you may reply to this message.",
    "",
    "RideShare Admin",
  ].join("\n");
}

export default function AdminDisputeDetailPageClient() {
  const router = useRouter();
  const params = useParams();

  const disputeId = useMemo(() => {
    const raw = params?.disputeId;
    return typeof raw === "string" ? raw.trim() : "";
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AdminDisputeDetailResponse | null>(null);

  const [status, setStatus] = useState("OPEN");
  const [adminNotes, setAdminNotes] = useState("");
  const [refundAmountInput, setRefundAmountInput] = useState("");
  const [markRefundIssued, setMarkRefundIssued] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [emailRecipientKind, setEmailRecipientKind] =
    useState<EmailRecipientKind>("CUSTOM");

  const routeLabel = useMemo(() => {
    if (!data || !data.ok) return "";
    return `${data.ride.originCity} → ${data.ride.destinationCity}`;
  }, [data]);

  function getRecipientName(kind: EmailRecipientKind) {
    if (!data || !data.ok) return null;
    if (kind === "RIDER") return data.ride.riderName;
    if (kind === "DRIVER") return data.ride.driverName;
    return null;
  }

  function getRecipientEmail(kind: EmailRecipientKind) {
    if (!data || !data.ok) return "";
    if (kind === "RIDER") return data.ride.riderEmail || "";
    if (kind === "DRIVER") return data.ride.driverEmail || "";
    return "";
  }

  function applyEmailTemplate(kind: EmailRecipientKind) {
    if (!data || !data.ok) return;

    setEmailRecipientKind(kind);

    if (kind !== "CUSTOM") {
      setEmailTo(getRecipientEmail(kind));
    }

    setEmailSubject(buildDefaultSubject(routeLabel));
    setEmailBody(
      buildDefaultMessage({
        recipientName: getRecipientName(kind),
        routeLabel,
        status,
        adminNotes,
      })
    );
    setEmailError(null);
    setEmailSuccess(null);
  }

  useEffect(() => {
    let cancelled = false;

    async function markRelatedNotificationsRead(
      loadedDisputeId: string,
      loadedBookingId: string
    ) {
      try {
        await fetch("/api/notifications/read", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            disputeId: loadedDisputeId,
            bookingId: loadedBookingId,
            type: "DISPUTE_OPENED",
          }),
        });
      } catch (err) {
        console.error(
          "[admin dispute detail] mark notifications read failed:",
          err
        );
      }
    }

    async function load() {
      if (!disputeId) {
        setData({ ok: false, error: "Missing disputeId" });
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

        const res = await fetch(
          `/api/admin/disputes/${encodeURIComponent(disputeId)}`,
          {
            cache: "no-store",
          }
        );

        const json =
          (await res.json().catch(() => null)) as AdminDisputeDetailResponse | null;

        if (!res.ok || !json) {
          throw new Error("Failed to load dispute details.");
        }

        if (json.ok === false) {
          throw new Error(json.error || "Failed to load dispute details.");
        }

        if (!cancelled) {
          const nextRouteLabel = `${json.ride.originCity} → ${json.ride.destinationCity}`;

          setData(json);
          setStatus(json.dispute.status || "OPEN");
          setAdminNotes(json.dispute.adminNotes || "");
          setRefundAmountInput(
            centsToInput(
              json.dispute.refundAmountCents ?? json.booking.finalAmountCents
            )
          );
          setMarkRefundIssued(Boolean(json.dispute.refundIssued));

          setEmailRecipientKind("CUSTOM");
          setEmailTo("");
          setEmailSubject(buildDefaultSubject(nextRouteLabel));
          setEmailBody(
            buildDefaultMessage({
              recipientName: json.ride.riderName,
              routeLabel: nextRouteLabel,
              status: json.dispute.status,
              adminNotes: json.dispute.adminNotes || "",
            })
          );
        }

        await markRelatedNotificationsRead(json.dispute.id, json.dispute.bookingId);
      } catch (err: unknown) {
        if (!cancelled) {
          setData({
            ok: false,
            error:
              err instanceof Error ? err.message : "Failed to load dispute details.",
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
  }, [disputeId]);

  useEffect(() => {
    if (!data || !data.ok) return;
    if (emailRecipientKind === "CUSTOM") return;

    setEmailSubject(buildDefaultSubject(routeLabel));
    setEmailBody(
      buildDefaultMessage({
        recipientName: getRecipientName(emailRecipientKind),
        routeLabel,
        status,
        adminNotes,
      })
    );
  }, [data, emailRecipientKind, routeLabel, status, adminNotes]);

  useEffect(() => {
    if (status !== "RESOLVED_RIDER") {
      setMarkRefundIssued(false);
    }
  }, [status]);

  async function handleSave() {
    if (!disputeId || !data || !data.ok) return;

    try {
      setSaving(true);
      setSaveError(null);
      setSaveSuccess(null);

      const parsedRefundAmount =
        status === "RESOLVED_RIDER"
          ? parseRefundCents(refundAmountInput)
          : null;

      const refundAmountCents =
        status === "RESOLVED_RIDER"
          ? parsedRefundAmount ?? data.booking.finalAmountCents ?? null
          : null;

      const res = await fetch(
        `/api/admin/disputes/${encodeURIComponent(disputeId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status,
            adminNotes: adminNotes.trim(),
            refundAmountCents,
          }),
        }
      );

      const json = (await res.json().catch(() => null)) as UpdateResponse | null;

      if (!res.ok || !json) {
        throw new Error("Failed to update dispute.");
      }

      if (json.ok === false) {
        throw new Error(json.error || "Failed to update dispute.");
      }

      setSaveSuccess("Dispute updated successfully.");

      setData((prev) => {
        if (!prev || !prev.ok) return prev;
        return {
          ...prev,
          dispute: {
            ...prev.dispute,
            status: json.dispute.status,
            adminDecision: json.dispute.adminDecision,
            adminNotes: json.dispute.adminNotes,
            resolvedAt: json.dispute.resolvedAt,
            refundIssued: json.dispute.refundIssued,
            refundAmountCents: json.dispute.refundAmountCents,
            refundIssuedAt: json.dispute.refundIssuedAt,
          },
        };
      });

      setRefundAmountInput(centsToInput(json.dispute.refundAmountCents));
      setMarkRefundIssued(Boolean(json.dispute.refundIssued));

      router.refresh();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to update dispute.");
    } finally {
      setSaving(false);
    }
  }

  function fillEmailForRider() {
    applyEmailTemplate("RIDER");
  }

  function fillEmailForDriver() {
    applyEmailTemplate("DRIVER");
  }

  async function handleSendEmail() {
    if (!disputeId) return;

    try {
      setEmailSending(true);
      setEmailError(null);
      setEmailSuccess(null);

      const res = await fetch(
        `/api/admin/disputes/${encodeURIComponent(disputeId)}/email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: emailTo.trim(),
            subject: emailSubject.trim(),
            body: emailBody.trim(),
          }),
        }
      );

      const json = (await res.json().catch(() => null)) as SendEmailResponse | null;

      if (!res.ok || !json) {
        throw new Error("Failed to send email.");
      }

      if (json.ok === false) {
        throw new Error(json.error || "Failed to send email.");
      }

      setEmailSuccess(`Email sent to ${json.sentTo}.`);
      router.refresh();
    } catch (err: unknown) {
      setEmailError(err instanceof Error ? err.message : "Failed to send email.");
    } finally {
      setEmailSending(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Dispute review
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Review and manage this fallback charge dispute.
            </p>
          </div>

          <Link
            href="/admin/disputes"
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
                Case summary
              </h2>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Dispute ID
                  </p>
                  <p className="mt-1 text-sm text-slate-700">{data.dispute.id}</p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Current status
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {statusLabel(data.dispute.status)}
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
                    Driver
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {data.ride.driverName || "Unknown"}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Created at
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {new Date(data.dispute.createdAt).toLocaleString()}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Resolved at
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {data.dispute.resolvedAt
                      ? new Date(data.dispute.resolvedAt).toLocaleString()
                      : "Not resolved"}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Refund recorded
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {data.dispute.refundIssued ? "Yes" : "No"}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Refund amount
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {data.dispute.refundIssued
                      ? money(
                          data.dispute.refundAmountCents,
                          data.booking.currency
                        )
                      : "Not recorded"}
                  </p>
                </div>

                <div className="md:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Refund issued at
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {data.dispute.refundIssuedAt
                      ? new Date(data.dispute.refundIssuedAt).toLocaleString()
                      : "Not recorded"}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">
                Original charge
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
                    Driver reported reason
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {driverReasonLabel(data.booking.cashNotPaidReason)}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Fallback charged at
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {data.booking.fallbackCardChargedAt
                      ? new Date(
                          data.booking.fallbackCardChargedAt
                        ).toLocaleString()
                      : "Unknown"}
                  </p>
                </div>

                <div className="md:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Driver note
                  </p>
                  <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    {data.booking.cashNotPaidNote || "No note provided"}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">
                Rider dispute
              </h2>

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
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">
                Admin action
              </h2>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="OPEN">Open</option>
                    <option value="UNDER_REVIEW">Under review</option>
                    <option value="RESOLVED_RIDER">
                      Resolved in rider&apos;s favor
                    </option>
                    <option value="RESOLVED_DRIVER">
                      Resolved in driver&apos;s favor
                    </option>
                    <option value="CLOSED">Closed</option>
                  </select>
                </div>

                {status === "RESOLVED_RIDER" ? (
                  <>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        Refund amount (cents)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={refundAmountInput}
                        onChange={(e) => setRefundAmountInput(e.target.value)}
                        placeholder={
                          typeof data.booking.finalAmountCents === "number"
                            ? String(data.booking.finalAmountCents)
                            : "Enter refund amount in cents"
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        Default should normally match the charged amount.
                      </p>
                    </div>

                    <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <input
                        type="checkbox"
                        checked={markRefundIssued}
                        onChange={(e) => setMarkRefundIssued(e.target.checked)}
                        className="mt-1 h-4 w-4"
                      />
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          Mark refund as issued
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          This records the refund inside the dispute case and audit
                          log. It does not send money through Stripe by itself.
                        </p>
                      </div>
                    </label>
                  </>
                ) : null}

                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Admin notes
                  </label>
                  <textarea
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    rows={6}
                    placeholder="Add internal notes about your review and decision."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                {saveError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                    {saveError}
                  </div>
                ) : null}

                {saveSuccess ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                    {saveSuccess}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>

                  <Link
                    href="/admin/disputes"
                    className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </Link>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Send email</h2>

              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={fillEmailForRider}
                    className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Fill rider
                  </button>

                  <button
                    type="button"
                    onClick={fillEmailForDriver}
                    className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Fill driver
                  </button>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    To
                  </label>
                  <input
                    type="email"
                    value={emailTo}
                    onChange={(e) => {
                      setEmailRecipientKind("CUSTOM");
                      setEmailTo(e.target.value);
                    }}
                    placeholder="recipient@example.com"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Email subject"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Message
                  </label>
                  <textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    rows={8}
                    placeholder="Write your message."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                {emailError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                    {emailError}
                  </div>
                ) : null}

                {emailSuccess ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                    {emailSuccess}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleSendEmail}
                    disabled={emailSending}
                    className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {emailSending ? "Sending…" : "Send email"}
                  </button>
                </div>
              </div>
            </section>

            {data.auditLogs && data.auditLogs.length > 0 ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">Audit log</h2>

                <div className="mt-4 space-y-3">
                  {data.auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                    >
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">
                            {auditActionLabel(log.actionType)}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Admin: {log.adminUserName || "Unknown"}
                          </p>
                          {log.notes ? (
                            <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-700">
                              {log.notes}
                            </div>
                          ) : null}
                        </div>

                        <div className="shrink-0 text-xs text-slate-500">
                          {new Date(log.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
