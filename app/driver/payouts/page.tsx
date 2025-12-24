import Link from "next/link";

export default function DriverPayoutsPage() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Payouts</h1>
        <p className="mt-2 text-sm text-slate-600">
          Coming soon.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            className="rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            href="/driver/portal"
          >
            Driver portal
          </Link>
          <Link
            className="rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
            href="/billing/membership"
          >
            Membership billing
          </Link>
        </div>
      </div>
    </main>
  );
}
