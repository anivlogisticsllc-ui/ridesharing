"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export default function DashboardRedirectPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;

    // Not logged in → go to login, and come back to /dashboard after
    if (!session) {
      router.replace("/auth/login?callbackUrl=/dashboard");
      return;
    }

    const role = (session.user as any).role as
      | "RIDER"
      | "DRIVER"
      | "BOTH"
      | undefined;

    if (role === "DRIVER") {
      router.replace("/driver");
    } else if (role === "RIDER") {
      router.replace("/rider");
    } else if (role === "BOTH") {
      // You can make this smarter later (pick or show a choice UI)
      router.replace("/driver");
    } else {
      // fallback
      router.replace("/");
    }
  }, [session, status, router]);

  return (
    <div className="py-10 text-center text-sm text-slate-600">
      Redirecting to your dashboard…
    </div>
  );
}
