import Link from "next/link";
import { useSession } from "next-auth/react";

export default function DriverPaymentsPage() {
  const { data: session, status } = useSession();

  if (status === "loading") return <main style={{ padding: 24 }}>Loading…</main>;

  if (!session) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Driver payments</h1>
        <p>Please sign in.</p>
        <Link href="/auth/login?callbackUrl=/driver/payments">Sign in</Link>
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
