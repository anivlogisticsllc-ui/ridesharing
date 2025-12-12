// pages/account/setup.tsx
import { useEffect } from "react";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";

export default function AccountSetupRouter() {
  const router = useRouter();
  const { data: session } = useSession();

  useEffect(() => {
    const role = (session?.user as any)?.role as
      | "RIDER"
      | "DRIVER"
      | "BOTH"
      | undefined;

    if (!role) {
      router.replace("/auth/login?callbackUrl=/account/setup");
      return;
    }

    if (role === "DRIVER" || role === "BOTH") {
      router.replace("/account/setup-driver");
    } else {
      router.replace("/account/setup-rider");
    }
  }, [session, router]);

  return null;
}
