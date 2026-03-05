// lib/convenienceFee.ts
export function computeConvenienceFeeCents(fareCents: number): number {
  const fare = Number.isFinite(fareCents) ? Math.max(0, Math.round(fareCents)) : 0;

  const base = 200; // $2.00
  const pct = Math.round(fare * 0.10); // 10%

  const fee = base + pct;

  const max = 1000; // $10.00 safety cap (optional but recommended)
  return Math.min(max, fee);
}
