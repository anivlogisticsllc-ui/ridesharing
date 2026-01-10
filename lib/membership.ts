// lib/membership.ts

export type MeMembership = {
  plan: string | null; // legacy/display only
  active: boolean; // computed on server (or derived)
  status?: "ACTIVE" | "EXPIRED" | null;

  trialEndsAt: string | null; // ISO
  currentPeriodEnd: string | null; // ISO (membership expiry)
  cancelAtPeriodEnd: boolean; // reserved for Stripe later
};

export type MembershipState = "TRIAL" | "ACTIVE" | "EXPIRED" | "NONE";

export function computeMembershipState(
  m: MeMembership | null | undefined
): { state: MembershipState; label: string; endsAtLabel: string | null } {
  if (!m) return { state: "NONE", label: "No membership", endsAtLabel: null };

  const now = Date.now();

  const trialEndsAtMs = m.trialEndsAt ? Date.parse(m.trialEndsAt) : NaN;
  const periodEndMs = m.currentPeriodEnd ? Date.parse(m.currentPeriodEnd) : NaN;

  const inTrial = Number.isFinite(trialEndsAtMs) && trialEndsAtMs > now;
  const periodValid = Number.isFinite(periodEndMs) && periodEndMs > now;
  const periodExpired = Number.isFinite(periodEndMs) && periodEndMs <= now;

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
      endsAtLabel: Number.isFinite(periodEndMs) ? formatDate(m.currentPeriodEnd) : null,
    };
  }

  return { state: "NONE", label: "Not active", endsAtLabel: null };
}

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;

  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}
