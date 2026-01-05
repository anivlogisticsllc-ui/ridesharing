"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const ROUTES = {
  login: "/auth/login",
  membership: "/billing/membership",
  driverPortal: "/driver/portal",
} as const;

export default function DriverPayoutsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace(
        `${ROUTES.login}?callbackUrl=${encodeURIComponent("/driver/payouts")}`
      );
      return;
    }

    const role = (session.user as any)?.role as string | undefined;
    if (role !== "DRIVER" && role !== "ADMIN") {
      router.replace("/");
    }
  }, [session, status, router]);

  if (status === "loading") {
    return <p className="py-10 text-center text-slate-600">Loading…</p>;
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Payouts</h1>

        <p className="mt-2 text-sm text-slate-600">
          Coming soon. Driver earnings and payout history will appear here.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href={ROUTES.driverPortal}
            className="rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            Driver portal
          </Link>

          <Link
            href={ROUTES.membership}
            className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
          >
            Membership billing
          </Link>
        </div>
      </div>
    </main>
  );
}
