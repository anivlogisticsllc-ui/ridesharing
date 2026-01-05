"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Role = "RIDER" | "DRIVER" | "ADMIN";

function asRole(v: unknown): Role | null {
  return v === "RIDER" || v === "DRIVER" || v === "ADMIN" ? v : null;
}

export default function DashboardRedirectPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace("/auth/login?callbackUrl=/dashboard");
      return;
    }

    const role = asRole((session.user as any)?.role);

    if (role === "DRIVER") {
      router.replace("/driver");
      return;
    }

    if (role === "RIDER") {
      router.replace("/rider");
      return;
    }

    if (role === "ADMIN") {
      // Pick your preferred admin landing page.
      // If you don’t have one yet, sending home is safer than looping.
      router.replace("/");
      return;
    }

    router.replace("/");
  }, [session, status, router]);

  return (
    <div className="py-10 text-center text-sm text-slate-600">
      Redirecting to your dashboard…
    </div>
  );
}
