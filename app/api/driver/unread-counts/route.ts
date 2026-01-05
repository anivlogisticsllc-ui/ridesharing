// app/driver/portal/page.tsx
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import DriverPortalInner from "./DriverPortalInner";

export default async function DriverPortalPage() {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; role?: string } | undefined;

  if (!user?.id) {
    redirect(`/auth/login?callbackUrl=${encodeURIComponent("/driver/portal")}`);
  }

  if (user.role !== "DRIVER") {
    redirect("/");
  }

  const profile = await prisma.driverProfile.findUnique({
    where: { userId: user.id },
    select: { verificationStatus: true },
  });

  // Driver hasn't created a profile yet → send to setup flow
  if (!profile) {
    redirect("/account/setup-driver");
  }

  // Driver profile exists but not approved → send to profile/verification page
  if (profile.verificationStatus !== "APPROVED") {
    redirect("/driver/profile");
  }

  return <DriverPortalInner />;
}
