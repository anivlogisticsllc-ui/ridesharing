// lib/money.ts

export function formatUsdFromCents(
  cents: number | null | undefined,
  opts?: { showZero?: boolean }
): string {
  const showZero = opts?.showZero ?? true;
  if (cents == null) return showZero ? "$0.00" : "—";

  const dollars = cents / 100;
  // Keep it simple for MVP
  return dollars.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formats a saved payment method label consistently for UI tables.
 * Example: formatCardLabel({ brand: "visa", last4: "4242" }) -> "VISA •••• 4242"
 */
export function formatCardLabel(input: {
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
}): string {
  const brand = (input.brand || "CARD").toUpperCase();
  const last4 = input.last4 ? String(input.last4).slice(-4) : "----";

  // Keep expiry optional; don’t force it into every label unless you want it
  // const exp =
  //   input.expMonth && input.expYear ? `  ${String(input.expMonth).padStart(2, "0")}/${String(input.expYear).slice(-2)}` : "";

  return `${brand} •••• ${last4}`;
}
