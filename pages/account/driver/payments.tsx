// pages/account/driver/payments.tsx
"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";

type Role = "RIDER" | "DRIVER" | "ADMIN";
function asRole(v: unknown): Role | null {
  return v === "RIDER" || v === "DRIVER" || v === "ADMIN" ? v : null;
}

export default function DriverPaymentsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace("/auth/login?callbackUrl=/account/driver/payments");
      return;
    }

    const role = asRole((session.user as any)?.role);
    if (role !== "DRIVER" && role !== "ADMIN") {
      router.replace("/");
    }
  }, [session, status, router]);

  if (status === "loading") return <main style={{ padding: 24 }}>Loading…</main>;

  if (!session) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Driver payments</h1>
        <p>Please sign in.</p>
        <Link href="/auth/login?callbackUrl=/account/driver/payments">Sign in</Link>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Driver payments</h1>
      <p>Coming soon: service fees, payout calculations, and transfer history.</p>
      <p style={{ marginTop: 12 }}>
        For now, use <Link href="/account/billing">Account billing</Link>.
      </p>
    </main>
  );
}
