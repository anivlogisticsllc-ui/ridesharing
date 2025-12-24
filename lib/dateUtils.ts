// lib/dateUtils.ts

export function parseIsoDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Days remaining until `iso` (ceil). Returns null if invalid/missing.
 * If already passed, returns 0.
 */
export function daysUntil(iso: string | null | undefined): number | null {
  const d = parseIsoDate(iso);
  if (!d) return null;
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}
