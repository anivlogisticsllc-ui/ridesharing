// app/membership/page.tsx
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

export default async function MembershipPage() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role as
    | "RIDER"
    | "DRIVER"
    | "BOTH"
    | undefined;

  const isRider = role === "RIDER" || role === "BOTH" || !role;
  const isDriver = role === "DRIVER" || role === "BOTH" || !role;

  const showBoth = !session || role === "BOTH";

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-slate-900">
            Membership
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Choose the plan that matches how you use the platform.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Rider plan */}
          {((showBoth && isRider) || (session && role === "RIDER")) && (
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm flex flex-col justify-between">
              <div>
                <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                  Rider membership
                </span>
                <h2 className="mt-3 text-lg font-semibold text-slate-900">
                  Riders · $2.99 / month
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  For passengers who want to book shared rides.
                </p>
                <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                  <li>• Browse and book rides</li>
                  <li>• See driver ratings &amp; verification status</li>
                  <li>• In-app chat with drivers after booking</li>
                  <li>• Transparent pricing: $3 + $2/mile</li>
                </ul>
              </div>
              <button className="mt-4 w-full rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100">
                {session ? "Manage rider membership" : "Choose rider plan"}
              </button>
            </div>
          )}

          {/* Driver plan */}
          {((showBoth && isDriver) || (session && role === "DRIVER")) && (
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm flex flex-col justify-between">
              <div>
                <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                  Driver membership
                </span>
                <h2 className="mt-3 text-lg font-semibold text-slate-900">
                  Drivers · $9.99 / month
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  For drivers who want to offer rides and earn from trips
                  they&apos;re already making.
                </p>
                <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                  <li>• Post rides and manage capacity</li>
                  <li>• See all booking requests in one place</li>
                  <li>• In-app messaging with passengers</li>
                  <li>• Earnings breakdown per ride</li>
                </ul>
              </div>
              <button className="mt-4 w-full rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
                {session ? "Manage driver membership" : "Choose driver plan"}
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
