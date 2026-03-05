// lib/membership.ts

export type MeMembership = {
  plan: string | null; // legacy/display only
  active: boolean; // computed on server
  status?: "ACTIVE" | "EXPIRED" | null;

  trialEndsAt: string | null; // ISO
  currentPeriodEnd: string | null; // ISO (membership expiry)
  cancelAtPeriodEnd: boolean; // reserved for Stripe later
};

export type MembershipState = "TRIAL" | "ACTIVE" | "EXPIRED" | "NONE";

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function formatDate(iso: string | null): string | null {
  const ms = parseIsoMs(iso);
  if (ms === null) return null;

  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function computeMembershipState(
  m: MeMembership | null | undefined
): { state: MembershipState; label: string; endsAtLabel: string | null } {
  if (!m) return { state: "NONE", label: "No membership", endsAtLabel: null };

  const now = Date.now();
  const trialEndsAtMs = parseIsoMs(m.trialEndsAt);
  const periodEndMs = parseIsoMs(m.currentPeriodEnd);

  const inTrial = trialEndsAtMs !== null && trialEndsAtMs > now;

  const periodValid = periodEndMs !== null && periodEndMs > now;
  const periodExpired = periodEndMs !== null && periodEndMs <= now;

  if (inTrial) {
    return {
      state: "TRIAL",
      label: "Trial",
      endsAtLabel: formatDate(m.trialEndsAt),
    };
  }

  if (periodExpired || m.status === "EXPIRED") {
    return {
      state: "EXPIRED",
      label: "Expired",
      endsAtLabel: formatDate(m.currentPeriodEnd),
    };
  }

  if (m.active || periodValid || m.status === "ACTIVE") {
    return {
      state: "ACTIVE",
      label: "Active",
      endsAtLabel: periodEndMs !== null ? formatDate(m.currentPeriodEnd) : null,
    };
  }

  return { state: "NONE", label: "Not active", endsAtLabel: null };
}