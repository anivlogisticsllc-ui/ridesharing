// lib/membership.ts

export type MeMembership = {
  plan: string | null;               // e.g. "STANDARD" (legacy string)
  active: boolean;                   // computed on server
  status?: "ACTIVE" | "EXPIRED" | null; // optional: if server provides it
  trialEndsAt: string | null;        // ISO string
  currentPeriodEnd: string | null;   // ISO string (latest Membership.expiryDate)
  cancelAtPeriodEnd: boolean;        // reserved for Stripe later
};

export type MembershipState = "TRIAL" | "ACTIVE" | "EXPIRED" | "NONE";

export function computeMembershipState(
  m: MeMembership | null | undefined
): {
  state: MembershipState;
  label: string;
  endsAtLabel: string | null;
} {
  if (!m) return { state: "NONE", label: "No membership", endsAtLabel: null };

  const now = Date.now();

  const trialEndsAtMs = m.trialEndsAt ? Date.parse(m.trialEndsAt) : NaN;
  const periodEndMs = m.currentPeriodEnd ? Date.parse(m.currentPeriodEnd) : NaN;

  const hasTrialEnd = Number.isFinite(trialEndsAtMs);
  const hasPeriodEnd = Number.isFinite(periodEndMs);

  const inTrial = hasTrialEnd && trialEndsAtMs > now;
  const periodExpired = hasPeriodEnd && periodEndMs <= now;
  const periodValid = hasPeriodEnd && periodEndMs > now;

  // Trial always wins
  if (inTrial) {
    return {
      state: "TRIAL",
      label: "Trial",
      endsAtLabel: formatDate(m.trialEndsAt),
    };
  }

  // If we have an expiry and it's past, call it expired even if `active` says true.
  // This is a safety valve for inconsistent data.
  if (periodExpired || m.status === "EXPIRED") {
    return {
      state: "EXPIRED",
      label: "Expired",
      endsAtLabel: formatDate(m.currentPeriodEnd),
    };
  }

  // Active if server said active OR we have a valid period end OR status says ACTIVE
  if (m.active || periodValid || m.status === "ACTIVE") {
    return {
      state: "ACTIVE",
      label: "Active",
      endsAtLabel: hasPeriodEnd ? formatDate(m.currentPeriodEnd) : null,
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
