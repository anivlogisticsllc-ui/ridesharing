// app/rider/trips/[rideId]/page.tsx
"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type BookingStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "EXPIRED";
type PaymentType = "CARD" | "CASH";

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

  // pricing / payment
  paymentType?: PaymentType | null;
  cashDiscountBps?: number | null;
  baseTotalPriceCents?: number | null;
  effectiveTotalPriceCents?: number | null;
  totalPriceCents?: number | null;

  // cash override / audit trail (make sure your API returns these if you want them shown)
  originalPaymentType?: PaymentType | null;
  originalCashDiscountBps?: number | null;
  cashNotPaidAt?: string | null;
  cashDiscountRevokedAt?: string | null;
  cashDiscountRevokedReason?: string | null;
  fallbackCardChargedAt?: string | null;
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

function isChatReadOnly(b: Booking): boolean {
  const completed = b.status === "COMPLETED" || b.rideStatus === "COMPLETED";
  const cancelledLike = b.status === "CANCELLED" || b.status === "EXPIRED";
  return completed || cancelledLike;
}

function getEffectiveFareCents(b: Booking): number | null {
  if (typeof b.effectiveTotalPriceCents === "number") return b.effectiveTotalPriceCents;
  if (typeof b.totalPriceCents === "number") return b.totalPriceCents;
  if (typeof b.baseTotalPriceCents === "number") return b.baseTotalPriceCents;
  return null;
}

function pctFromBps(bps: number | null | undefined): number {
  const n = typeof bps === "number" && Number.isFinite(bps) ? bps : 0;
  return Math.round(n / 100); // 1000 bps => 10
}

export default function RiderTripPage() {
  const router = useRouter();
  const params = useParams();

  const rawRideId = params?.rideId;
  const rideId = typeof rawRideId === "string" ? decodeURIComponent(rawRideId) : null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);

  const [activeChat, setActiveChat] = useState<{ conversationId: string; readOnly: boolean } | null>(null);

  useEffect(() => {
    if (!rideId) return;

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/rider/bookings");
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `HTTP ${res.status}`);
        }

        const data: ApiResponse = await res.json();
        if (!data.ok) throw new Error(data.error || "Failed to load bookings");

        const match = data.bookings.find((b) => b.rideId === rideId) || null;
        if (!cancelled) setBooking(match);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to load trip";
        console.error(e);
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [rideId]);

  const readOnly = useMemo(() => (booking ? isChatReadOnly(booking) : true), [booking]);

  if (!rideId) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <button
          type="button"
          onClick={() => router.back()}
          style={{
            padding: "6px 12px",
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
      <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <p>Loading trip...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <button
          type="button"
          onClick={() => router.back()}
          style={{
            padding: "6px 12px",
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
      <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <button
          type="button"
          onClick={() => router.back()}
          style={{
            padding: "6px 12px",
            borderRadius: 999,
            border: "1px solid #d1d5db",
            background: "#fff",
            cursor: "pointer",
            marginBottom: 12,
          }}
        >
          Back
        </button>
        <p>Trip not found (rideId: {rideId}).</p>
      </main>
    );
  }

  const dt = safeDate(booking.departureTime) ?? new Date(booking.departureTime);

  const base = typeof booking.baseTotalPriceCents === "number" ? booking.baseTotalPriceCents : null;
  const effective = getEffectiveFareCents(booking);

  const hasDiscount =
    base != null && effective != null && Number.isFinite(base) && Number.isFinite(effective) && effective < base;

  const showCashOverrideAudit =
    booking.originalPaymentType != null ||
    booking.cashNotPaidAt != null ||
    booking.cashDiscountRevokedAt != null ||
    booking.fallbackCardChargedAt != null;

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => router.back()}
          style={{
            padding: "6px 12px",
            borderRadius: 999,
            border: "1px solid #d1d5db",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Back
        </button>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {booking.bookingId && (
            <button
              type="button"
              onClick={() => {
                const id = booking.bookingId;
                if (!id) return; // satisfies TS and protects runtime
                const url = `/receipt/${encodeURIComponent(id)}?autoprint=1`;
                window.open(url, "_blank", "noopener,noreferrer");
              }}
              style={{
                padding: "6px 12px",
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

          {booking.conversationId && (
            <button
              type="button"
              onClick={() =>
                setActiveChat({
                  conversationId: booking.conversationId!,
                  readOnly,
                })
              }
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: "1px solid #d1d5db",
                background: "#fff",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Chat {readOnly ? "(read-only)" : ""}
            </button>
          )}
        </div>
      </div>

      <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700 }}>
        {booking.originCity} → {booking.destinationCity}
      </h1>

      <p style={{ margin: 0, color: "#4b5563" }}>Departure: {dt.toLocaleString()}</p>

      <div
        style={{
          marginTop: 14,
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
              <strong>Distance:</strong> {booking.distanceMiles.toFixed(2)} mi
            </div>
          )}

          {effective != null && (
            <div>
              <strong>Fare:</strong>{" "}
              {hasDiscount && base != null ? (
                <>
                  <span style={{ textDecoration: "line-through", color: "#6b7280", marginRight: 8 }}>
                    ${formatMoney(base)}
                  </span>
                  <span style={{ fontWeight: 700 }}>${formatMoney(effective)}</span>
                  <span style={{ marginLeft: 8, color: "#166534", fontWeight: 600 }}>
                    ({booking.paymentType === "CASH" ? "cash discount" : "discount"})
                  </span>
                </>
              ) : (
                <span style={{ fontWeight: 700 }}>${formatMoney(effective)}</span>
              )}
            </div>
          )}

          {booking.paymentType && (
            <div>
              <strong>Payment:</strong> {booking.paymentType}
              {booking.paymentType === "CASH" && (booking.cashDiscountBps ?? 0) > 0 ? (
                <span style={{ marginLeft: 8, color: "#166534", fontWeight: 600 }}>
                  ({pctFromBps(booking.cashDiscountBps)}% off)
                </span>
              ) : null}
            </div>
          )}

          {booking.passengerCount != null && (
            <div>
              <strong>Passengers:</strong> {booking.passengerCount}
            </div>
          )}

          {booking.tripStartedAt && (
            <div>
              <strong>Trip started:</strong> {new Date(booking.tripStartedAt).toLocaleString()}
            </div>
          )}

          {booking.tripCompletedAt && (
            <div>
              <strong>Trip completed:</strong> {new Date(booking.tripCompletedAt).toLocaleString()}
            </div>
          )}
        </div>
      </div>

      {showCashOverrideAudit && (
        <div
          style={{
            marginTop: 14,
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 14,
            background: "#fff",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Cash override audit</div>

          <div style={{ fontSize: 13, color: "#374151", display: "grid", gap: 6 }}>
            {booking.originalPaymentType && (
              <div>
                <strong>Original booking payment:</strong> {booking.originalPaymentType}
                {booking.originalPaymentType === "CASH" && (booking.originalCashDiscountBps ?? 0) > 0 ? (
                  <span style={{ marginLeft: 8, color: "#166534", fontWeight: 600 }}>
                    ({pctFromBps(booking.originalCashDiscountBps)}% off)
                  </span>
                ) : null}
              </div>
            )}

            {booking.cashNotPaidAt && (
              <div>
                <strong>Cash not paid reported at:</strong> {new Date(booking.cashNotPaidAt).toLocaleString()}
              </div>
            )}

            {booking.cashDiscountRevokedAt && (
              <div>
                <strong>Cash discount revoked at:</strong> {new Date(booking.cashDiscountRevokedAt).toLocaleString()}
              </div>
            )}

            {booking.cashDiscountRevokedReason && (
              <div>
                <strong>Revocation reason:</strong> {booking.cashDiscountRevokedReason}
              </div>
            )}

            {booking.fallbackCardChargedAt && (
              <div>
                <strong>Fallback card charged at:</strong> {new Date(booking.fallbackCardChargedAt).toLocaleString()}
              </div>
            )}
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

function ChatOverlay(props: { conversationId: string; readOnly: boolean; onClose: () => void }) {
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
          boxShadow: "0 20px 35px rgba(15,23,42,0.35), 0 0 0 1px rgba(148,163,184,0.15)",
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
          <span style={{ fontWeight: 600 }}>Chat with driver {readOnly ? "(read-only)" : ""}</span>
          <button
            type="button"
            onClick={onClose}
            style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
            aria-label="Close chat"
          >
            ×
          </button>
        </div>

        <iframe src={src} style={{ border: "none", width: "100%", height: "100%" }} title="Chat" />
      </div>
    </div>
  );
}