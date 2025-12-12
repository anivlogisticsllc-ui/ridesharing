"use client";

import { useEffect, useMemo, useState } from "react";

type RideStatus = "OPEN" | "FULL" | "IN_ROUTE" | "COMPLETED";

type TripMeterProps = {
  status: RideStatus;
  tripStartedAt: string | Date | null;
  tripCompletedAt: string | Date | null;
  onStartRide: () => Promise<void> | void;
  onCompleteRide: (summary: {
    elapsedSeconds: number;
    distanceMiles: number;
    fareCents: number;
  }) => Promise<void> | void;

  // Fake pricing knobs (in USD)
  baseFare?: number;   // dollars
  perMinute?: number;  // dollars per minute
  perMile?: number;    // dollars per mile
};

/* ---------- Helpers ---------- */

function parseDate(value: string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  return `${pad(minutes)}:${pad(seconds)}`;
}

/* ---------- Component ---------- */

export function TripMeter({
  status,
  tripStartedAt,
  tripCompletedAt,
  onStartRide,
  onCompleteRide,
  baseFare = 3.0,
  perMinute = 0.5,
  perMile = 1.2,
}: TripMeterProps) {
  const startedAt = useMemo(() => parseDate(tripStartedAt), [tripStartedAt]);
  const completedAt = useMemo(
    () => parseDate(tripCompletedAt),
    [tripCompletedAt]
  );

  const [now, setNow] = useState<Date>(() => new Date());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isActive = status === "IN_ROUTE";
  const isCompleted = status === "COMPLETED";

  // Tick only while the trip is in route
  useEffect(() => {
    if (!isActive) return;

    const id = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(id);
  }, [isActive]);

  /* ---------- Elapsed time ---------- */

  const elapsedMs = useMemo(() => {
    if (!startedAt) {
      // If the backend never gave us a start time, treat as 0
      return 0;
    }

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

  /* ---------- Fake distance + fare ---------- */

  // Assume ~25 mph ≈ 0.416 miles / minute
  const distanceMilesRaw = Math.max(0, elapsedMinutes * 0.416);
  const distanceMiles = Number.isFinite(distanceMilesRaw)
    ? distanceMilesRaw
    : 0;

  const estimatedFareDollarsRaw =
    baseFare +
    Math.max(0, elapsedMinutes * perMinute) +
    distanceMiles * perMile;

  const estimatedFareDollars = Number.isFinite(estimatedFareDollarsRaw)
    ? estimatedFareDollarsRaw
    : 0;

  const estimatedFareCents = Math.round(estimatedFareDollars * 100);

  /* ---------- Button handlers ---------- */

  const handleStartClick = async () => {
    if (isSubmitting || status === "IN_ROUTE" || status === "COMPLETED") {
      return;
    }

    try {
      setIsSubmitting(true);
      await onStartRide();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteClick = async () => {
    // ✅ NEW: gate completion on backend status, not local timer state
    if (isSubmitting || status !== "IN_ROUTE") {
      return;
    }

    try {
      setIsSubmitting(true);
      await onCompleteRide({
        elapsedSeconds,
        distanceMiles,
        fareCents: estimatedFareCents,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ---------- Render ---------- */

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
      {/* Header row: status + timer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color: "#4b5563",
          }}
        >
          Trip meter
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

      {/* Metrics row */}
      <div
        style={{
          display: "flex",
          gap: 12,
          fontSize: 12,
          color: "#4b5563",
        }}
      >
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
            Fare (est.)
          </div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            ${estimatedFareDollars.toFixed(2)}
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            Base + time + distance
          </div>
        </div>
      </div>

      {/* Footer: primary action button + status pill */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 4,
        }}
      >
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
                borderRadius: "999px",
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
