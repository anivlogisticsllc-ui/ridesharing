import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { redirect } from "next/navigation";

export default async function DriverDashboard() {
  const session = await getServerSession(authOptions);

  // Protect the page: only drivers can access
  if (!session || !["DRIVER"].includes((session.user as any)?.role)) {
    redirect("/");
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold text-slate-900 mb-4">
        Driver dashboard
      </h1>

      <p className="text-slate-700 text-sm">
        Here you’ll manage your rides, see booking requests, and track future earnings.
      </p>

      {/* Later you will add: */}
      {/* 
        - Matched rider requests
        - Completed rides
        - Earnings summary
        - Ride history
      */}
    </main>
  );
}
