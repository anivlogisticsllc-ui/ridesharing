"use client";

import { useEffect, useMemo, useState } from "react";
import {
  RideStatus,
  PaymentType,
  bpsToPercentLabel,
  buildTripMeterSnapshot,
  formatTripDuration,
} from "@/lib/trip-meter";

type RiderTripMeterProps = {
  status: RideStatus;
  tripStartedAt: string | Date | null;
  tripCompletedAt: string | Date | null;
  paymentType?: PaymentType | null;
  cashDiscountBps?: number | null;

  onRequestCompleteTrip?: () => Promise<void> | void;
  requestBusy?: boolean;
  requestSent?: boolean;

  baseFare?: number;
  perMinute?: number;
  perMile?: number;

  driverName?: string | null;
};

export function RiderTripMeter({
  status,
  tripStartedAt,
  tripCompletedAt,
  paymentType = null,
  cashDiscountBps = null,
  onRequestCompleteTrip,
  requestBusy = false,
  requestSent = false,
  baseFare = 3.0,
  perMinute = 0.5,
  perMile = 1.2,
  driverName = null,
}: RiderTripMeterProps) {
  const [now, setNow] = useState<Date>(() => new Date());

  const isActive = status === "IN_ROUTE";
  const isCompleted = status === "COMPLETED";

  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  const snapshot = useMemo(
    () =>
      buildTripMeterSnapshot({
        status,
        tripStartedAt,
        tripCompletedAt,
        now,
        baseFare,
        perMinute,
        perMile,
      }),
    [status, tripStartedAt, tripCompletedAt, now, baseFare, perMinute, perMile]
  );

  const showCash = paymentType === "CASH";
  const showCard = paymentType === "CARD";
  const discountLabel =
    showCash && typeof cashDiscountBps === "number" && cashDiscountBps > 0
      ? ` (-${bpsToPercentLabel(cashDiscountBps)})`
      : "";

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: "#ffffff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: "#4b5563",
            }}
          >
            Ride meter
          </div>

          {(showCash || showCard) && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#f8fafc",
                color: "#111827",
                whiteSpace: "nowrap",
              }}
            >
              {showCash ? `CASH${discountLabel}` : "CARD"}
            </span>
          )}

          {driverName ? (
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              Driver: <span style={{ fontWeight: 600, color: "#111827" }}>{driverName}</span>
            </span>
          ) : null}
        </div>

        <div
          style={{
            fontVariantNumeric: "tabular-nums",
            fontFamily: "system-ui, sans-serif",
            fontSize: 20,
            fontWeight: 700,
            color: "#111827",
          }}
        >
          {formatTripDuration(snapshot.elapsedMs)}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
        <div
          style={{
            flex: 1,
            minWidth: 160,
            padding: 8,
            borderRadius: 8,
            background: "#f8fafc",
            border: "1px solid #e5e7eb",
          }}
        >
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
            Distance (est.)
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>
            {snapshot.distanceMiles > 0 ? `${snapshot.distanceMiles.toFixed(2)} miles` : "—"}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 160,
            padding: 8,
            borderRadius: 8,
            background: "#f8fafc",
            border: "1px solid #e5e7eb",
          }}
        >
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
            Fare (est.)
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>
            ${snapshot.estimatedFareDollars.toFixed(2)}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        {isActive && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 8px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              background: "#dcfce7",
              color: "#166534",
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: "#22c55e",
              }}
            />
            Meter running
          </span>
        )}

        {isCompleted && (
          <span
            style={{
              padding: "4px 8px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              background: "#e5e7eb",
              color: "#374151",
              whiteSpace: "nowrap",
            }}
          >
            Trip completed
          </span>
        )}

        {isActive && onRequestCompleteTrip ? (
          <button
            type="button"
            onClick={() => onRequestCompleteTrip()}
            disabled={requestBusy || requestSent}
            style={{
              marginLeft: "auto",
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #d1d5db",
              background: requestSent ? "#f3f4f6" : "#ffffff",
              color: requestSent ? "#6b7280" : "#111827",
              fontSize: 13,
              fontWeight: 600,
              cursor: requestBusy || requestSent ? "not-allowed" : "pointer",
            }}
          >
            {requestBusy
              ? "Sending..."
              : requestSent
              ? "Request sent"
              : "Complete Trip"}
          </button>
        ) : null}
      </div>
    </div>
  );
}