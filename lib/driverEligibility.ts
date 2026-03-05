// lib/driverEligibility.ts
export type VerificationStatus = "PENDING" | "APPROVED" | "REJECTED";

export type MembershipInfo = {
  active: boolean;
  trialEndsAt?: string | null; // ISO string
};

function isTrialValid(trialEndsAt?: string | null): boolean {
  if (!trialEndsAt) return false;
  const t = Date.parse(trialEndsAt);
  return Number.isFinite(t) && t > Date.now();
}

export function canAcceptRides(args: {
  verificationStatus: VerificationStatus | null | undefined;
  membership: MembershipInfo | null | undefined;
}) {
  const verificationOk = args.verificationStatus === "APPROVED";
  const membershipOk = !!args.membership?.active || isTrialValid(args.membership?.trialEndsAt);
  return verificationOk && membershipOk;
}

export function driverBlockReason(args: {
  verificationStatus: VerificationStatus | null | undefined;
  membership: MembershipInfo | null | undefined;
}) {
  if (args.verificationStatus !== "APPROVED") {
    return "Driver verification is not approved yet.";
  }
  const ok = !!args.membership?.active || isTrialValid(args.membership?.trialEndsAt);
  if (!ok) {
    return "Membership is not active (and trial is not valid).";
  }
  return null;
}