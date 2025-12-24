// lib/driverEligibility.ts
export type VerificationStatus = "PENDING" | "APPROVED" | "REJECTED";

export type MembershipStatus =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

export function canAcceptRides(args: {
  verificationStatus: VerificationStatus | null | undefined;
  membership: { active: boolean; status: MembershipStatus } | null | undefined;
}) {
  const verificationOk = args.verificationStatus === "APPROVED";
  const membershipOk = !!args.membership?.active && args.membership.status === "active";
  return verificationOk && membershipOk;
}

export function driverBlockReason(args: {
  verificationStatus: VerificationStatus | null | undefined;
  membership: { active: boolean; status: MembershipStatus } | null | undefined;
}) {
  if (args.verificationStatus !== "APPROVED") {
    return "Driver verification is not approved yet.";
  }
  if (!args.membership?.active || args.membership.status !== "active") {
    return "Membership is not active.";
  }
  return null;
}
