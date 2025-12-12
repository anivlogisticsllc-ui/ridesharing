// components/MembershipSelector.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MembershipSelector() {
  const router = useRouter();
  const [selected, setSelected] = useState<"RIDER" | "DRIVER">("RIDER");

  function handleChoose(plan: "RIDER" | "DRIVER") {
    setSelected(plan);
    // send them to register with preselected role
    const roleParam = plan === "RIDER" ? "RIDER" : "DRIVER";
    router.push(`/auth/register?role=${roleParam}`);
  }

  return (
    <section className="mt-6 space-y-4">
      {/* role toggle */}
      <div className="inline-flex rounded-full bg-slate-100 p-1 text-xs font-medium">
        <button
          type="button"
          onClick={() => setSelected("RIDER")}
          className={`px-3 py-1 rounded-full transition ${
            selected === "RIDER"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-slate-700"
          }`}
        >
          I&apos;m a Rider
        </button>
        <button
          type="button"
          onClick={() => setSelected("DRIVER")}
          className={`px-3 py-1 rounded-full transition ${
            selected === "DRIVER"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-slate-700"
          }`}
        >
          I&apos;m a Driver
        </button>
      </div>

      <h2 className="text-base font-semibold text-slate-900">
        Membership plans
      </h2>
      <p className="text-xs text-slate-600">
        Both rider and driver plans start with a{" "}
        <span className="font-semibold text-emerald-700">
          30-day free membership
        </span>
        . No payment is required during setup. After the trial you can decide
        whether to continue on a paid plan.
      </p>

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {/* Rider card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
              Rider membership
            </span>
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              First month free
            </span>
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-900">
            Riders · $2.99 / month <span className="text-xs font-normal text-slate-500">(after free trial)</span>
          </p>
          <ul className="mt-2 space-y-1 text-xs text-slate-700 list-disc list-inside">
            <li>Browse and book rides</li>
            <li>See driver ratings and verification</li>
            <li>In-app chat after booking</li>
            <li>Transparent pricing: $3 booking + $2/mile</li>
          </ul>
          <button
            type="button"
            onClick={() => handleChoose("RIDER")}
            className="mt-3 w-full rounded-full bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition"
          >
            Choose rider plan (first month free)
          </button>
        </div>

        {/* Driver card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              Driver membership
            </span>
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              First month free
            </span>
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-900">
            Drivers · $9.99 / month <span className="text-xs font-normal text-slate-500">(after free trial)</span>
          </p>
          <ul className="mt-2 space-y-1 text-xs text-slate-700 list-disc list-inside">
            <li>Post rides and routes</li>
            <li>Manage booking requests</li>
            <li>Chat with passengers</li>
            <li>View earnings per ride in dashboard</li>
          </ul>
          <button
            type="button"
            onClick={() => handleChoose("DRIVER")}
            className="mt-3 w-full rounded-full bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition"
          >
            Choose driver plan (first month free)
          </button>
        </div>
      </div>
    </section>
  );
}
