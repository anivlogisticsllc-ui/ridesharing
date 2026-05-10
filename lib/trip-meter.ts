// lib/trip-meter.ts

export type RideStatus = "OPEN" | "FULL" | "IN_ROUTE" | "COMPLETED";
export type PaymentType = "CARD" | "CASH";

export type TripMeterPricing = {
  baseFare?: number; // dollars
  perMinute?: number; // dollars per minute
  perMile?: number; // dollars per mile
};

export type TripMeterSnapshot = {
  elapsedMs: number;
  elapsedSeconds: number;
  elapsedMinutes: number;
  distanceMiles: number;
  estimatedFareDollars: number;
  estimatedFareCents: number;
};

export function parseTripDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatTripDuration(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  return `${pad(minutes)}:${pad(seconds)}`;
}

export function bpsToPercentLabel(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

export function buildTripMeterSnapshot(args: {
  status: RideStatus;
  tripStartedAt: string | Date | null;
  tripCompletedAt: string | Date | null;
  now?: Date;
  baseFare?: number;
  perMinute?: number;
  perMile?: number;
}): TripMeterSnapshot {
  const {
    status,
    tripStartedAt,
    tripCompletedAt,
    now = new Date(),
    baseFare = 3.0,
    perMinute = 0.5,
    perMile = 1.2,
  } = args;

  const startedAt = parseTripDate(tripStartedAt);
  const completedAt = parseTripDate(tripCompletedAt);

  let elapsedMs = 0;

  if (startedAt) {
    if (status === "COMPLETED" && completedAt) {
      elapsedMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
    } else if (status === "IN_ROUTE") {
      elapsedMs = Math.max(0, now.getTime() - startedAt.getTime());
    }
  }

  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const elapsedMinutes = elapsedMs / 1000 / 60;

  // Transitional placeholder logic until real GPS/backend truth is wired in.
  const distanceMilesRaw = Math.max(0, elapsedMinutes * 0.416);
  const distanceMiles = Number.isFinite(distanceMilesRaw) ? distanceMilesRaw : 0;

  const estimatedFareDollarsRaw =
    baseFare + Math.max(0, elapsedMinutes * perMinute) + distanceMiles * perMile;

  const estimatedFareDollars = Number.isFinite(estimatedFareDollarsRaw)
    ? estimatedFareDollarsRaw
    : 0;

  const estimatedFareCents = Math.round(estimatedFareDollars * 100);

  return {
    elapsedMs,
    elapsedSeconds,
    elapsedMinutes,
    distanceMiles,
    estimatedFareDollars,
    estimatedFareCents,
  };
}