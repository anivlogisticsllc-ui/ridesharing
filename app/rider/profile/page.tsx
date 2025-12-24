"use client";

import Link from "next/link";
import { useMe } from "@/lib/useMe";
import MembershipBadge from "@/components/MembershipBadge";

export default function RiderProfilePage() {
  const { data, loading } = useMe();

  const membership =
    !loading && data && (data as any).ok === true
      ? (data as any).membership
      : null;

  return (
    <main
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "24px 16px 40px",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ fontSize: 26, fontWeight: 650, margin: 0 }}>Rider profile</h1>
        {membership ? <MembershipBadge membership={membership} /> : null}
      </div>

      <p style={{ fontSize: 14, color: "#555", marginTop: 8, marginBottom: 16 }}>
        This is a placeholder profile page. Later you can add contact info, documents, and preferences here.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <Link href="/billing/membership" style={linkBtn}>
          Membership & billing
        </Link>
        <Link href="/" style={linkBtn}>
          Back to Home
        </Link>
      </div>

      <div
        style={{
          borderRadius: 10,
          border: "1px solid #e5e7eb",
          padding: 16,
          background: "#f9fafb",
          fontSize: 14,
        }}
      >
        <p style={{ margin: 0 }}>
          Profile details will go here (name, email, phone, ID docs, etc.).
        </p>
      </div>
    </main>
  );
}

const linkBtn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  textDecoration: "none",
  fontSize: 14,
  fontWeight: 600,
};
