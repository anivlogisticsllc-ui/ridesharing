import { useEffect } from "react";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";

type Role = "RIDER" | "DRIVER" | "ADMIN";
function asRole(v: unknown): Role | null {
  return v === "RIDER" || v === "DRIVER" || v === "ADMIN" ? v : null;
}

export default function AccountSetupRouter() {
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "loading") return;

    const role = asRole((session?.user as any)?.role);

    if (!role) {
      router.replace("/auth/login?callbackUrl=/account/setup");
      return;
    }

    if (role === "DRIVER" || role === "ADMIN") {
      router.replace("/account/setup-driver");
      return;
    }

    router.replace("/account/setup-rider");
  }, [session, status, router]);

  return null;
}
