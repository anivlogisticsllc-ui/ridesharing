// app/rider/trips/[rideId]/page.tsx

"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type BookingStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "EXPIRED";
type PaymentType = "CARD" | "CASH";
type TipStatus =
  | "NOT_OFFERED"
  | "ELIGIBLE"
  | "PENDING"
  | "SUCCEEDED"
  | "SKIPPED"
  | "FAILED";

type Booking = {
  id: string;
  bookingId: string | null;

  status: BookingStatus;
  rideId: string;
  originCity: string;
  destinationCity: string;
  departureTime: string;
  rideStatus: string;
  driverName: string | null;
  driverPublicId: string | null;
  conversationId: string | null;

  distanceMiles?: number | null;
  passengerCount?: number | null;
  tripStartedAt?: string | null;
  tripCompletedAt?: string | null;

  paymentType?: PaymentType | null;
  cashDiscountBps?: number | null;
  baseTotalPriceCents?: number | null;
  effectiveTotalPriceCents?: number | null;
  totalPriceCents?: number | null;

  originalPaymentType?: PaymentType | null;
  originalCashDiscountBps?: number | null;
  cashNotPaidAt?: string | null;
  cashDiscountRevokedAt?: string | null;
  cashDiscountRevokedReason?: string | null;
  fallbackCardChargedAt?: string | null;

  refundIssued?: boolean | null;
  refundAmountCents?: number | null;
  refundIssuedAt?: string | null;
  disputeResolvedAt?: string | null;

  tipStatus?: TipStatus | null;
  tipAmountCents?: number | null;
  tipPercent?: number | null;
  tipChargedAt?: string | null;
  tipSkippedAt?: string | null;
  tipEligibleUntil?: string | null;
};

type ApiResponse = { ok: true; bookings: Booking[] } | { ok: false; error: string };

function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

function normalizeCents(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

function isChatReadOnly(b: Booking): boolean {
  const completed = b.status === "COMPLETED" || b.rideStatus === "COMPLETED";
  const cancelledLike = b.status === "CANCELLED" || b.status === "EXPIRED";
  return completed || cancelledLike;
}

function getBaseFareCents(b: Booking): number | null {
  if (typeof b.baseTotalPriceCents === "number") return b.baseTotalPriceCents;
  if (typeof b.totalPriceCents === "number") return b.totalPriceCents;
  if (typeof b.effectiveTotalPriceCents === "number") return b.effectiveTotalPriceCents;
  return null;
}

function getEffectiveFareCents(b: Booking): number | null {
  if (typeof b.effectiveTotalPriceCents === "number") return b.effectiveTotalPriceCents;
  if (typeof b.totalPriceCents === "number") return b.totalPriceCents;
  if (typeof b.baseTotalPriceCents === "number") return b.baseTotalPriceCents;
  return null;
}

function getDisplayPaymentLabel(b: Booking): string {
  if (b.paymentType === "CASH") return "CASH";
  if (b.paymentType === "CARD") return "CARD";
  return "n/a";
}

function getRideStatusBanner(booking: Booking) {
  if (booking.rideStatus === "ACCEPTED") {
    return {
      bg: "#eff6ff",
      border: "#93c5fd",
      text: "#1d4ed8",
      label: "Driver accepted your trip. Driver is on the way.",
    };
  }

  if (booking.rideStatus === "OPEN") {
    return {
      bg: "#fff7ed",
      border: "#fdba74",
      text: "#9a3412",
      label: "Trip requested. Waiting for driver acceptance.",
    };
  }

  if (booking.rideStatus === "COMPLETED") {
    return {
      bg: "#f8fafc",
      border: "#cbd5e1",
      text: "#334155",
      label: "Trip completed.",
    };
  }

  return null;
}

function getPollIntervalMs(booking: Booking | null) {
  if (!booking) return 1500;
  if (booking.rideStatus === "IN_ROUTE") return 10000;
  if (booking.rideStatus === "ACCEPTED") return 12000;
  if (
    booking.rideStatus === "COMPLETED" &&
    booking.paymentType === "CARD" &&
    booking.tipStatus === "ELIGIBLE"
  ) {
    return 4000;
  }
  return 30000;
}

function buildTipOptions(baseFareCents: number) {
  return [10, 15, 20].map((percent) => ({
    percent,
    amountCents: Math.max(1, Math.round(baseFareCents * (percent / 100))),
  }));
}

function formatElapsed(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export default function RiderTripPage() {
  const router = useRouter();
  const params = useParams();

  const rawRideId = params?.rideId;
  const rideId = typeof rawRideId === "string" ? decodeURIComponent(rawRideId) : null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [activeChat, setActiveChat] = useState<{ conversationId: string; readOnly: boolean } | null>(
    null
  );

  const [tipSubmitting, setTipSubmitting] = useState(false);
  const [selectedTipPercent, setSelectedTipPercent] = useState<number | null>(null);
  const [tipMessage, setTipMessage] = useState<string | null>(null);
  const [tipError, setTipError] = useState<string | null>(null);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [hasUnreadChat, setHasUnreadChat] = useState(false);

  async function loadTrip(targetRideId: string, opts?: { silent?: boolean }) {
    try {
      if (!opts?.silent) {
        setLoading(true);
        setError(null);
      }

      const res = await fetch("/api/rider/bookings", { cache: "no-store" });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }

      const data: ApiResponse = await res.json();
      if (!data.ok) {
        throw new Error(data.error || "Failed to load bookings");
      }

      const match = data.bookings.find((b) => b.rideId === targetRideId) || null;
      setBooking(match);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load trip";
      console.error(e);
      setError(msg);
    } finally {
      if (!opts?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!rideId) return;
    void loadTrip(rideId);
  }, [rideId]);

  useEffect(() => {
    if (!rideId || !booking) return;

    let cancelled = false;

    const intervalId = window.setInterval(() => {
      if (cancelled) return;
      void loadTrip(rideId, { silent: true });
    }, getPollIntervalMs(booking));

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [rideId, booking?.rideStatus, booking?.tipStatus, booking?.paymentType]);

  useEffect(() => {
    if (!booking?.tripStartedAt || booking.rideStatus !== "IN_ROUTE") {
      setElapsedSeconds(0);
      return;
    }

    const startedAt = new Date(booking.tripStartedAt).getTime();

    function tick() {
      const diff = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      setElapsedSeconds(diff);
    }

    tick();
    const id = window.setInterval(tick, 1000);

    return () => window.clearInterval(id);
  }, [booking?.tripStartedAt, booking?.rideStatus]);

  const isTripCompletedOrClosed = useMemo(
    () => (booking ? isChatReadOnly(booking) : true),
    [booking]
  );

  const chatDisabled = booking?.rideStatus === "IN_ROUTE";
  const readOnly = isTripCompletedOrClosed;

  useEffect(() => {
    if (!booking?.conversationId || readOnly || chatDisabled) {
      setHasUnreadChat(false);
      return;
    }

    let cancelled = false;

    async function loadChatNotifications() {
      try {
        const res = await fetch("/api/rider/chat-notifications", {
          cache: "no-store",
        });

        if (!res.ok) return;

        const data = await res.json().catch(() => null);
        if (!data || cancelled) return;

        const items = Array.isArray(data.notifications)
          ? data.notifications
          : Array.isArray(data.items)
          ? data.items
          : [];

        const conversationId = booking?.conversationId;
        if (!conversationId) {
          setHasUnreadChat(false);
          return;
        }

        const match = items.find(
          (item: any) =>
            item?.conversationId === conversationId ||
            item?.conversation?.id === conversationId
        );

        const unread =
          typeof match?.unreadCount === "number"
            ? match.unreadCount
            : typeof match?.newCount === "number"
            ? match.newCount
            : typeof match?.count === "number"
            ? match.count
            : match
            ? 1
            : 0;

        setHasUnreadChat(unread > 0);
      } catch (err) {
        console.error("[trip-page chat notifications] failed:", err);
      }
    }

    void loadChatNotifications();
    const id = window.setInterval(loadChatNotifications, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [booking?.conversationId, readOnly, chatDisabled]);

  if (!rideId) {
    return (
      <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <button
          type="button"
          onClick={() => router.back()}
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            border: "1px solid #d1d5db",
            background: "#fff",
            cursor: "pointer",
            marginBottom: 12,
          }}
        >
          Back
        </button>
        <p style={{ color: "red" }}>Missing rideId.</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <p>Loading trip...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <button
          type="button"
          onClick={() => router.back()}
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            border: "1px solid #d1d5db",
            background: "#fff",
            cursor: "pointer",
            marginBottom: 12,
          }}
        >
          Back
        </button>
        <p style={{ color: "red" }}>{error}</p>
      </main>
    );
  }

  if (!booking) {
    return (
      <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <button
          type="button"
          onClick={() => router.push("/rider/portal")}
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            border: "1px solid #d1d5db",
            background: "#fff",
            cursor: "pointer",
            marginBottom: 12,
          }}
        >
          Back to portal
        </button>
        <p>Trip not found (rideId: {rideId}).</p>
      </main>
    );
  }

  const departure = safeDate(booking.departureTime) ?? new Date(booking.departureTime);

  const baseFareCents = getBaseFareCents(booking);
  const effectiveFareCents = getEffectiveFareCents(booking);

  const isLiveMeterRunning = booking.rideStatus === "IN_ROUTE";

  const liveElapsedMinutes = isLiveMeterRunning ? elapsedSeconds / 60 : 0;

  const liveMeterDistanceMiles = isLiveMeterRunning
    ? Math.max(0, liveElapsedMinutes * 0.416)
    : 0;

  const liveMeterGrossFareCents = isLiveMeterRunning
    ? Math.round((3.0 + liveElapsedMinutes * 0.5 + liveMeterDistanceMiles * 1.2) * 100)
    : null;

  const liveDisplayFareCents = isLiveMeterRunning
    ? liveMeterGrossFareCents
    : effectiveFareCents;

  const liveDisplayDistanceMiles = isLiveMeterRunning
    ? liveMeterDistanceMiles
    : typeof booking.distanceMiles === "number"
    ? booking.distanceMiles
    : 0;

  const tipAmountCents = normalizeCents(booking.tipAmountCents);
  const hasTip = tipAmountCents > 0;
  const totalChargedCents =
    typeof effectiveFareCents === "number" ? effectiveFareCents : null;

  const pendingTip =
    booking.paymentType === "CARD" &&
    booking.tipStatus === "PENDING" &&
    tipAmountCents > 0;

  const finalTotalAfterTipCents =
    typeof baseFareCents === "number" ? baseFareCents + tipAmountCents : null;

  const displayPayment = getDisplayPaymentLabel(booking);
  const statusBanner = getRideStatusBanner(booking);

const tipWindowExpired =
  !!booking.tipEligibleUntil &&
  new Date(booking.tipEligibleUntil).getTime() < Date.now();

const tipEligible =
  booking.rideStatus === "COMPLETED" &&
  booking.paymentType === "CARD" &&
  booking.tipStatus === "ELIGIBLE" &&
  !tipWindowExpired &&
  typeof baseFareCents === "number" &&
  baseFareCents > 0;

  const tipOptions =
    typeof baseFareCents === "number" && baseFareCents > 0
      ? buildTipOptions(baseFareCents)
      : [];

  const selectedTipAmountCents =
    selectedTipPercent != null
      ? tipOptions.find((x) => x.percent === selectedTipPercent)?.amountCents ?? 0
      : 0;

  async function handleAddTip() {
    if (!rideId || !selectedTipPercent || !selectedTipAmountCents) return;

    try {
      setTipSubmitting(true);
      setTipError(null);
      setTipMessage(null);

      const res = await fetch("/api/rider/add-tip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rideId,
          tipAmountCents: selectedTipAmountCents,
          tipPercent: selectedTipPercent,
        }),
      });

      const data = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: string }
        | null;

      if (!res.ok || !data?.ok) {
        setTipError(data && "error" in data ? data.error : "Failed to add tip");
        return;
      }

      const updatedTotal = (baseFareCents ?? 0) + selectedTipAmountCents;
      setTipMessage(`Tip added. Final total updated to $${formatMoney(updatedTotal)}.`);
      setSelectedTipPercent(null);
      await loadTrip(rideId, { silent: true });
    } catch (err) {
      console.error(err);
      setTipError("Failed to add tip");
    } finally {
      setTipSubmitting(false);
    }
  }

  async function handleSkipTip() {
    if (!rideId) return;

    try {
      setTipSubmitting(true);
      setTipError(null);
      setTipMessage(null);

      const res = await fetch("/api/rider/skip-tip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rideId }),
      });

      const data = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: string }
        | null;

      if (!res.ok || !data?.ok) {
        setTipError(data && "error" in data ? data.error : "Failed to skip tip");
        return;
      }

      setTipMessage("No tip added. Final payment captured.");
      setSelectedTipPercent(null);
      await loadTrip(rideId, { silent: true });
    } catch (err) {
      console.error(err);
      setTipError("Failed to skip tip");
    } finally {
      setTipSubmitting(false);
    }
  }
async function handleRequestDriverStopMeter() {
  if (!rideId) return;

  try {
    setTipError(null);
    setTipMessage(null);

    const res = await fetch("/api/rider/request-complete-trip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rideId }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      setTipError(data?.error || "Failed to notify driver");
      return;
    }

    setTipMessage(data?.message || "Driver notified to stop meter.");
    await loadTrip(rideId, { silent: true });
  } catch (err) {
    console.error(err);
    setTipError("Failed to notify driver");
  }
}

  const liveCardTitle =
    booking.rideStatus === "IN_ROUTE"
      ? "Live fare estimate"
      : booking.rideStatus === "ACCEPTED"
      ? "Driver is on the way"
      : "Trip requested";

  const liveCardBg =
    booking.rideStatus === "IN_ROUTE"
      ? "#ecfdf5"
      : booking.rideStatus === "ACCEPTED"
      ? "#eff6ff"
      : "#fff7ed";

  const liveCardBorder =
    booking.rideStatus === "IN_ROUTE"
      ? "1px solid #86efac"
      : booking.rideStatus === "ACCEPTED"
      ? "1px solid #93c5fd"
      : "1px solid #fdba74";

  const liveCardText =
    booking.rideStatus === "IN_ROUTE"
      ? "#166534"
      : booking.rideStatus === "ACCEPTED"
      ? "#1d4ed8"
      : "#9a3412";

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      {statusBanner && (
        <div
          style={{
            marginBottom: 16,
            border: `1px solid ${statusBanner.border}`,
            borderRadius: 12,
            padding: 14,
            background: statusBanner.bg,
            color: statusBanner.text,
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          {statusBanner.label}
        </div>
      )}

      {tipMessage && (
        <div
          style={{
            marginBottom: 16,
            border: "1px solid #a7f3d0",
            borderRadius: 12,
            padding: 12,
            background: "#ecfdf5",
            color: "#065f46",
            fontWeight: 600,
          }}
        >
          {tipMessage}
        </div>
      )}

      {tipError && (
        <div
          style={{
            marginBottom: 16,
            border: "1px solid #fecaca",
            borderRadius: 12,
            padding: 12,
            background: "#fef2f2",
            color: "#991b1b",
            fontWeight: 600,
          }}
        >
          {tipError}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => router.push("/rider/portal")}
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            border: "1px solid #d1d5db",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Back to portal
        </button>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {booking.bookingId && (
            <button
              type="button"
              onClick={() => {
                const id = booking.bookingId;
                if (!id) return;
                const url = `/receipt/${encodeURIComponent(id)}?autoprint=1`;
                window.open(url, "_blank", "noopener,noreferrer");
              }}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: "1px solid #d1d5db",
                background: "#fff",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Receipt
            </button>
          )}

          {booking.bookingId && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const res = await fetch("/api/rider/resend-receipt", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ bookingId: booking.bookingId }),
                  });

                  const data = (await res.json().catch(() => null)) as
                    | { ok: true }
                    | { ok: false; error: string }
                    | null;

                  if (!res.ok || !data?.ok) {
                    setTipError(data && "error" in data ? data.error : "Failed to resend receipt");
                    return;
                  }

                  setTipMessage("Receipt email sent.");
                } catch (err) {
                  console.error(err);
                  setTipError("Failed to resend receipt");
                }
              }}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: "1px solid #d1d5db",
                background: "#fff",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Email receipt
            </button>
          )}

          {booking.conversationId && (
            <button
              type="button"
              disabled={chatDisabled}
              onClick={() => {
                if (chatDisabled) return;

                setActiveChat({
                  conversationId: booking.conversationId!,
                  readOnly,
                });
                setHasUnreadChat(false);
              }}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: chatDisabled
                  ? "1px solid #d1d5db"
                  : hasUnreadChat
                  ? "1px solid #ef4444"
                  : "1px solid #86efac",
                background: chatDisabled
                  ? "#f3f4f6"
                  : hasUnreadChat
                  ? "#fef2f2"
                  : "#ecfdf5",
                color: chatDisabled
                  ? "#9ca3af"
                  : hasUnreadChat
                  ? "#991b1b"
                  : "#166534",
                cursor: chatDisabled ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
                fontWeight: chatDisabled || hasUnreadChat || booking.rideStatus === "ACCEPTED" ? 800 : 600,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                opacity: chatDisabled ? 0.9 : 1,
              }}
            >
              {chatDisabled
                ? "Chat unavailable"
                : readOnly
                ? "Chat (read-only)"
                : hasUnreadChat
                ? "Open chat"
                : "Chat available"}

              {!chatDisabled && (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: hasUnreadChat ? "#ef4444" : "#22c55e",
                    display: "inline-block",
                  }}
                />
              )}
            </button>
          )}       
           </div>
      </div>

      <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700 }}>
        {booking.originCity} → {booking.destinationCity}
      </h1>

      <p style={{ margin: 0, color: "#4b5563" }}>Departure: {departure.toLocaleString()}</p>

      {(booking.rideStatus === "OPEN" || booking.rideStatus === "ACCEPTED") && (
        <div
          style={{
            marginTop: 16,
            border: liveCardBorder,
            borderRadius: 14,
            padding: 16,
            background: liveCardBg,
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 800,
              marginBottom: 12,
              color: liveCardText,
            }}
          >
            {liveCardTitle}
          </div>

          <div
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 12,
              padding: 14,
              background: "#fff",
            }}
          >
            <div style={{ fontSize: 14, color: "#334155" }}>
              {booking.rideStatus === "ACCEPTED"
                ? "Driver accepted your trip and is on the way."
                : "Waiting for driver acceptance."}
            </div>
          </div>
        </div>
      )}

      {booking.rideStatus === "IN_ROUTE" && (
        <div
          style={{
            marginTop: 16,
            border: "1px solid #86efac",
            borderRadius: 16,
            padding: 16,
            background: "#ecfdf5",
            boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: "#166534",
                }}
              >
                Live fare estimate
              </div>

              {booking.paymentType && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#111827",
                  }}
                >
                  {booking.paymentType}
                </span>
              )}
            </div>

            <div
              style={{
                fontSize: 34,
                fontWeight: 800,
                lineHeight: 1,
                color: "#0f172a",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatElapsed(elapsedSeconds)}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <div
              style={{
                border: "1px dashed #cbd5e1",
                borderRadius: 12,
                padding: 14,
                background: "#fff",
              }}
            >
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
                Distance (est.)
              </div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  color: "#111827",
                  lineHeight: 1.1,
                }}
              >
                {booking.distanceMiles != null ? booking.distanceMiles.toFixed(2) : "0.00"} miles
              </div>
            </div>

            <div
              style={{
                border: "1px dashed #cbd5e1",
                borderRadius: 12,
                padding: 14,
                background: "#fff",
              }}
            >
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
                Estimated fare
              </div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  color: "#111827",
                  lineHeight: 1.1,
                }}
              >
                ${formatMoney(liveDisplayFareCents ?? 0)}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                Base + time + distance
              </div>
            </div>

            {booking.paymentType === "CASH" && booking.cashDiscountBps ? (
              <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                Cash discount applies at completion.
              </div>
            ) : null}

            <div
              style={{
                border: "1px dashed #cbd5e1",
                borderRadius: 12,
                padding: 14,
                background: "#fff",
              }}
            >
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
                Elapsed
              </div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  color: "#111827",
                  lineHeight: 1.1,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatElapsed(elapsedSeconds)}
              </div>
            </div>
          </div>

          {booking.tripStartedAt && (
            <div
              style={{
                marginTop: 14,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: 13, color: "#475569" }}>
                Started: {new Date(booking.tripStartedAt).toLocaleTimeString()}
              </div>

              <div style={{ marginTop: 14 }}>
                <button
                  type="button"
                  onClick={handleRequestDriverStopMeter}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 999,
                    border: "1px solid #f59e0b",
                    background: "#fffbeb",
                    color: "#92400e",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  Ask driver to stop meter
                </button>
              </div>

              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: "#dcfce7",
                  color: "#166534",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: "#22c55e",
                    display: "inline-block",
                  }}
                />
                Meter running
              </div>
            </div>
          )}
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 14,
          background: "#fff",
        }}
      >
        <div style={{ fontSize: 13, color: "#374151", display: "grid", gap: 6 }}>
          <div>
            <strong>Ride ID:</strong> {booking.rideId}
          </div>
          <div>
            <strong>Booking ID:</strong> {booking.bookingId ?? "Not booked yet"}
          </div>
          <div>
            <strong>Status:</strong> {booking.status} / {booking.rideStatus}
          </div>

          {booking.driverName && (
            <div>
              <strong>Driver:</strong> {booking.driverName}
            </div>
          )}

          {booking.distanceMiles != null && (
            <div>
              <strong>Distance:</strong> {liveDisplayDistanceMiles > 0 ? `${liveDisplayDistanceMiles.toFixed(2)} miles` : "—"}
            </div>
          )}

          {typeof baseFareCents === "number" && (
            <div>
              <strong>Estimated ride fare:</strong>{" "}
              <span style={{ fontWeight: 700 }}>${formatMoney(baseFareCents)}</span>
            </div>
          )}

          {hasTip && !pendingTip && (
            <div>
              <strong>Tip:</strong>{" "}
              <span style={{ fontWeight: 700 }}>${formatMoney(tipAmountCents)}</span>
              {booking.tipPercent ? (
                <span style={{ marginLeft: 8 }}>({booking.tipPercent}%)</span>
              ) : null}
            </div>
          )}

          {pendingTip && (
            <div>
              <strong>Tip selected:</strong>{" "}
              <span style={{ fontWeight: 700 }}>${formatMoney(tipAmountCents)}</span>
              {booking.tipPercent ? (
                <span style={{ marginLeft: 8 }}>({booking.tipPercent}%)</span>
              ) : null}
              <span style={{ marginLeft: 8, color: "#b45309" }}>(pending)</span>
            </div>
          )}

          {pendingTip && typeof finalTotalAfterTipCents === "number" && (
            <div>
              <strong>Final total after tip:</strong>{" "}
              <span style={{ fontWeight: 700 }}>
                ${formatMoney(finalTotalAfterTipCents)}
              </span>
            </div>
          )}

          {!pendingTip && typeof totalChargedCents === "number" && (
            <div>
              <strong>Total due:</strong>{" "}
              <span style={{ fontWeight: 700 }}>${formatMoney(totalChargedCents)}</span>
            </div>
          )}

          {pendingTip && typeof totalChargedCents === "number" && (
            <div>
              <strong>Charged so far:</strong>{" "}
              <span style={{ fontWeight: 700 }}>${formatMoney(totalChargedCents)}</span>
            </div>
          )}
        </div>
      </div>

      {tipEligible && (
        <div
          style={{
            marginTop: 20,
            border: "1px solid #c7d2fe",
            borderRadius: 14,
            padding: 16,
            background: "#eef2ff",
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, color: "#312e81" }}>
            Add a tip for your driver
          </div>

          <div style={{ color: "#4338ca", marginBottom: 16 }}>
            Show appreciation before this trip moves fully into your completed history.
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            {tipOptions.map((option) => {
              const selected = selectedTipPercent === option.percent;

              return (
                <button
                  key={option.percent}
                  type="button"
                  disabled={tipSubmitting}
                  onClick={() => setSelectedTipPercent(option.percent)}
                  style={{
                    padding: "12px 18px",
                    borderRadius: 999,
                    border: selected ? "2px solid #111827" : "1px solid #cbd5e1",
                    background: selected ? "#0f172a" : "#fff",
                    color: selected ? "#fff" : "#111827",
                    fontWeight: 700,
                    cursor: tipSubmitting ? "not-allowed" : "pointer",
                  }}
                >
                  {option.percent}% (${formatMoney(option.amountCents)})
                </button>
              );
            })}
          </div>

          <div
            style={{
              border: "1px solid #c7d2fe",
              borderRadius: 12,
              padding: 14,
              background: "#fff",
              marginBottom: 16,
              fontSize: 16,
            }}
          >
            <span>Estimated ride fare: </span>
            <strong>${formatMoney(baseFareCents ?? 0)}</strong>

            {selectedTipAmountCents > 0 ? (
              <>
                <span style={{ marginLeft: 12 }}>Tip: </span>
                <strong>${formatMoney(selectedTipAmountCents)}</strong>

                <span style={{ marginLeft: 12 }}>Total after tip: </span>
                <strong>${formatMoney((baseFareCents ?? 0) + selectedTipAmountCents)}</strong>
              </>
            ) : (
              <span style={{ marginLeft: 12, color: "#475569" }}>
                Choose a tip amount to continue
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleAddTip}
              disabled={tipSubmitting || selectedTipAmountCents <= 0}
              style={{
                padding: "14px 20px",
                borderRadius: 999,
                border: "none",
                background: "#4f46e5",
                color: "#fff",
                fontWeight: 700,
                cursor: tipSubmitting || selectedTipAmountCents <= 0 ? "not-allowed" : "pointer",
                opacity: tipSubmitting || selectedTipAmountCents <= 0 ? 0.6 : 1,
              }}
            >
              {tipSubmitting ? "Processing..." : "Add tip and charge"}
            </button>

            <button
              type="button"
              onClick={handleSkipTip}
              disabled={tipSubmitting}
              style={{
                padding: "14px 20px",
                borderRadius: 999,
                border: "1px solid #cbd5e1",
                background: "#fff",
                color: "#111827",
                fontWeight: 700,
                cursor: tipSubmitting ? "not-allowed" : "pointer",
                opacity: tipSubmitting ? 0.6 : 1,
              }}
            >
              Skip for now
            </button>
          </div>
        </div>
      )}

      {activeChat && (
        <ChatOverlay
          conversationId={activeChat.conversationId}
          readOnly={activeChat.readOnly}
          onClose={() => setActiveChat(null)}
        />
      )}
    </main>
  );
}

function ChatOverlay(props: {
  conversationId: string;
  readOnly: boolean;
  onClose: () => void;
}) {
  const { conversationId, readOnly, onClose } = props;

  const params = new URLSearchParams();
  if (readOnly) params.set("readonly", "1");
  const qs = params.toString();
  const src = qs ? `/chat/${conversationId}?${qs}` : `/chat/${conversationId}`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: "min(900px, 100%)",
          height: "min(650px, 100%)",
          background: "#fff",
          borderRadius: 16,
          boxShadow:
            "0 20px 35px rgba(15,23,42,0.35), 0 0 0 1px rgba(148,163,184,0.15)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 14,
          }}
        >
          <span style={{ fontWeight: 600 }}>
            Chat with driver {readOnly ? "(read-only)" : ""}
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
            }}
            aria-label="Close chat"
          >
            ×
          </button>
        </div>

        <iframe
          src={src}
          style={{ border: "none", width: "100%", height: "100%" }}
          title="Chat"
        />
      </div>
    </div>
  );
}