// OATH: Clean replacement file
// FILE: app/admin/disputes/[disputeId]/page.tsx

import { Suspense } from "react";
import AdminDisputeDetailPageClient from "./client";

function LoadingFallback() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dispute review</h1>
          <p className="mt-1 text-sm text-slate-600">Loading dispute details…</p>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Loading…</p>
        </section>
      </div>
    </main>
  );
}

export default function AdminDisputeDetailPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <AdminDisputeDetailPageClient />
    </Suspense>
  );
}
