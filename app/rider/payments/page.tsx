import Link from "next/link";

export default function RiderPaymentsPage() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Rider payments</h1>
        <p className="mt-2 text-sm text-slate-600">
          Coming soon. Riders will pay $2.99/mo to reduce fake bookings.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            className="rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            href="/billing/membership"
          >
            Membership billing
          </Link>
          <Link
            className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
            href="/rider/portal"
          >
            Rider portal
          </Link>
        </div>
      </div>
    </main>
  );
}
