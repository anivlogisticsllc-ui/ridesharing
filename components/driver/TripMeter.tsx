// components/driver/TripMeter.tsx

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type RideStatus = "OPEN" | "FULL" | "IN_ROUTE" | "COMPLETED";
type PaymentType = "CARD" | "CASH";

type TripMeterProps = {
  rideId?: string | null;
  status: RideStatus;
  tripStartedAt: string | Date | null;
  tripCompletedAt: string | Date | null;

  onStartRide: () => Promise<void> | void;
  onCompleteRide: (summary: {
    elapsedSeconds: number;
    distanceMiles: number;
    fareCents: number;
  }) => Promise<void> | void;

  paymentType?: PaymentType | null;
  cashDiscountBps?: number | null;

  initialDistanceMiles?: number | null;
  initialFareCents?: number | null;

  baseFare?: number;
  perMinute?: number;
  perMile?: number;
};

function parseDate(value: string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDuration(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

function formatMoney(cents: number): string {
  return `$${(Math.max(0, Math.round(cents)) / 100).toFixed(2)}`;
}

function bpsToPercentLabel(bps: number): string {
  const pct = bps / 100;
  const label = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  return `${label}%`;
}

export function TripMeter({
  rideId = null,
  status,
  tripStartedAt,
  tripCompletedAt,
  onStartRide,
  onCompleteRide,
  paymentType = null,
  cashDiscountBps = null,
  initialDistanceMiles = null,
  initialFareCents = null,
  baseFare = 3.0,
  perMinute = 0.5,
  perMile = 1.2,
}: TripMeterProps) {
  const startedAt = useMemo(() => parseDate(tripStartedAt), [tripStartedAt]);
  const completedAt = useMemo(() => parseDate(tripCompletedAt), [tripCompletedAt]);

  const [now, setNow] = useState<Date>(() => new Date());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncingMeter, setIsSyncingMeter] = useState(false);

  const lastSyncedDistanceRef = useRef<number>(0);
  const lastSyncedFareRef = useRef<number>(0);
  const completingRef = useRef(false);

  const isActive = status === "IN_ROUTE";
  const isCompleted = status === "COMPLETED";
  const showCash = paymentType === "CASH";
  const showCard = paymentType === "CARD";

  useEffect(() => {
    if (!isActive) return;

    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [isActive]);

  const elapsedMs = useMemo(() => {
    if (!startedAt) return 0;

    if (isCompleted && completedAt) {
      return Math.max(0, completedAt.getTime() - startedAt.getTime());
    }

    if (isActive) {
      return Math.max(0, now.getTime() - startedAt.getTime());
    }

    return 0;
  }, [startedAt, completedAt, isCompleted, isActive, now]);

  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const elapsedMinutes = elapsedMs / 1000 / 60;

  const liveDistanceMilesRaw = Math.max(0, elapsedMinutes * 0.416);
  const liveDistanceMiles = Number.isFinite(liveDistanceMilesRaw)
    ? liveDistanceMilesRaw
    : 0;

  const distanceMiles =
    isCompleted &&
    typeof initialDistanceMiles === "number" &&
    Number.isFinite(initialDistanceMiles)
      ? initialDistanceMiles
      : liveDistanceMiles;

  const estimatedFareDollarsRaw =
    baseFare + Math.max(0, elapsedMinutes * perMinute) + liveDistanceMiles * perMile;

  const estimatedFareDollars = Number.isFinite(estimatedFareDollarsRaw)
    ? estimatedFareDollarsRaw
    : 0;

  const liveGrossFareCents = Math.round(estimatedFareDollars * 100);

  const grossFareCents =
    isCompleted &&
    typeof initialFareCents === "number" &&
    Number.isFinite(initialFareCents)
      ? Math.round(initialFareCents)
      : liveGrossFareCents;

  const cashDiscountCents =
    showCash &&
    isCompleted &&
    typeof cashDiscountBps === "number" &&
    cashDiscountBps > 0
      ? Math.round(grossFareCents * (cashDiscountBps / 10000))
      : 0;

  const displayedFareCents =
    showCash && isCompleted
      ? Math.max(0, grossFareCents - cashDiscountCents)
      : grossFareCents;

  useEffect(() => {
    if (!isActive || !rideId) return;

    let cancelled = false;

    async function syncMeter() {
      if (completingRef.current) return;

      const roundedDistance = Number(distanceMiles.toFixed(2));
      const roundedFare = Math.round(grossFareCents);

      const distanceChanged =
        Math.abs(roundedDistance - lastSyncedDistanceRef.current) >= 0.15;

      const fareChanged =
        Math.abs(roundedFare - lastSyncedFareRef.current) >= 25;

      if (!distanceChanged && !fareChanged) return;

      try {
        setIsSyncingMeter(true);

        const res = await fetch("/api/driver/update-meter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rideId,
            distanceMiles: roundedDistance,
            fareCents: roundedFare,
          }),
        });

        if (!res.ok || cancelled) return;

        lastSyncedDistanceRef.current = roundedDistance;
        lastSyncedFareRef.current = roundedFare;
      } catch (err) {
        console.error("Live meter sync failed:", err);
      } finally {
        if (!cancelled) setIsSyncingMeter(false);
      }
    }

    void syncMeter();

    const id = window.setInterval(syncMeter, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isActive, rideId, distanceMiles, grossFareCents]);

  async function handleStartClick() {
    if (isSubmitting || status === "IN_ROUTE" || status === "COMPLETED") return;

    try {
      setIsSubmitting(true);
      await onStartRide();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCompleteClick() {
    if (isSubmitting || status !== "IN_ROUTE") return;

    try {
      completingRef.current = true;
      setIsSubmitting(true);

      lastSyncedDistanceRef.current = distanceMiles;
      lastSyncedFareRef.current = grossFareCents;

      await onCompleteRide({
        elapsedSeconds,
        distanceMiles,
        fareCents: grossFareCents,
      });
    } finally {
      completingRef.current = false;
      setIsSubmitting(false);
    }
  }

  const discountLabel =
    showCash && typeof cashDiscountBps === "number" && cashDiscountBps > 0
      ? ` (-${bpsToPercentLabel(cashDiscountBps)})`
      : "";

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: "#f9fafb",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                color: "#4b5563",
              }}
            >
              Live trip estimate
            </div>

            {(showCard || showCash) && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: "1px solid #e5e7eb",
                  background: "#ffffff",
                  color: "#111827",
                  whiteSpace: "nowrap",
                }}
                title={showCash ? "Cash payment" : "Card payment"}
              >
                {showCash ? `CASH${discountLabel}` : "CARD"}
              </span>
            )}

            {isActive && (
              <span style={{ fontSize: 10, color: "#64748b" }}>
                {isSyncingMeter ? "syncing..." : "live"}
              </span>
            )}
          </div>

          <div style={{ fontSize: 11, color: "#6b7280" }}>
            Final fare is calculated at trip completion and may change as distance/time changes.
          </div>
        </div>

        <div
          style={{
            fontVariantNumeric: "tabular-nums",
            fontFamily: "system-ui, sans-serif",
            fontSize: 20,
            fontWeight: 600,
          }}
        >
          {formatDuration(elapsedMs)}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#4b5563" }}>
        <div
          style={{
            flex: 1,
            padding: 8,
            borderRadius: 6,
            background: "#ffffff",
            border: "1px dashed #e5e7eb",
          }}
        >
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
            Distance (est.)
          </div>

          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {distanceMiles > 0 ? `${distanceMiles.toFixed(2)} miles` : "—"}
          </div>

          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            GPS / odometer integration later
          </div>
        </div>

        <div
          style={{
            flex: 1,
            padding: 8,
            borderRadius: 6,
            background: "#ffffff",
            border: "1px dashed #e5e7eb",
          }}
        >
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
            Estimated rider fare
          </div>

          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {formatMoney(displayedFareCents)}
          </div>

          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            Base + time + distance
          </div>

          {showCash && !isCompleted && (
            <div style={{ marginTop: 6, fontSize: 11, color: "#64748b" }}>
              Cash discount applies at completion.
            </div>
          )}

          {showCash && isCompleted && cashDiscountCents > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: "#64748b" }}>
              Cash discount: -{formatMoney(cashDiscountCents)}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        {(status === "OPEN" || status === "FULL") && (
          <button
            type="button"
            onClick={handleStartClick}
            disabled={isSubmitting}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 6,
              border: "none",
              cursor: isSubmitting ? "default" : "pointer",
              background: "#16a34a",
              color: "#ffffff",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {isSubmitting ? "Starting…" : "Start trip / Start meter"}
          </button>
        )}

        {status === "IN_ROUTE" && (
          <button
            type="button"
            onClick={handleCompleteClick}
            disabled={isSubmitting}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 6,
              border: "none",
              cursor: isSubmitting ? "default" : "pointer",
              background: "#2563eb",
              color: "#ffffff",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {isSubmitting ? "Completing…" : "Complete ride"}
          </button>
        )}

        {isActive && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 8px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 500,
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
              fontWeight: 500,
              background: "#e5e7eb",
              color: "#374151",
              whiteSpace: "nowrap",
            }}
          >
            Trip completed
          </span>
        )}
      </div>
    </div>
  );
}