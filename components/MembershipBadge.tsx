// components/MembershipBadge.tsx
"use client";

import type { MeMembership } from "@/lib/membership";
import { computeMembershipState } from "@/lib/membership";

export default function MembershipBadge({ membership }: { membership: MeMembership | null | undefined }) {
  const { state, label } = computeMembershipState(membership);

  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    border: "1px solid #ddd",
    background: "#fff",
  };

  const dotStyle: React.CSSProperties = {
    width: 8,
    height: 8,
    borderRadius: 999,
    background:
      state === "ACTIVE" ? "green" :
      state === "TRIAL" ? "orange" :
      state === "EXPIRED" ? "crimson" :
      "#777",
  };

  return (
    <span style={style} title={`Membership: ${state}`}>
      <span style={dotStyle} />
      {label}
    </span>
  );
}
