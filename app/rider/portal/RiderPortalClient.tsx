"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type UpcomingRide = {
  id: string;
  pickupLabel: string;
  dropoffLabel: string;
  departureTime: string; // ISO
  // ...whatever else you already use
};

type CompletedRide = {
  id: string;
  pickupLabel: string;
  dropoffLabel: string;
  completedAt: string; // ISO
  // ...same fields as your current Completed card
};

type RangeFilter = "7D" | "30D" | "ALL";

type RiderPortalClientProps = {
  upcomingRides: UpcomingRide[];
  completedRides: CompletedRide[];
  activeCount: number;
  cancelledCount: number;
};

export function RiderPortalClient(props: RiderPortalClientProps) {
  const { upcomingRides, completedRides, activeCount, cancelledCount } = props;
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<"UPCOMING" | "COMPLETED">(
    "UPCOMING"
  );

  const [completedRange, setCompletedRange] =
    useState<RangeFilter>("30D");
  const [completedSearch, setCompletedSearch] = useState("");

  const totalBookings =
    activeCount + upcomingRides.length + completedRides.length + cancelledCount;

  const completedFiltered = useMemo(() => {
    const now = new Date();

    const cutoff =
      completedRange === "7D"
        ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        : completedRange === "30D"
        ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        : null;

    return completedRides.filter((ride) => {
      const completedAt = new Date(ride.completedAt);

      if (cutoff && completedAt < cutoff) return false;

      if (completedSearch.trim()) {
        const q = completedSearch.trim().toLowerCase();
        const haystack =
          `${ride.pickupLabel} ${ride.dropoffLabel}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [completedRides, completedRange, completedSearch]);

  return (
    <section className="space-y-6">
      {/* Header + Request button */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Rider portal
          </h1>
          <p className="text-sm text-slate-600">
            Track your upcoming and completed rides and manage your trips.
          </p>
        </div>

        <button
          type="button"
          onClick={() => router.push("/")} // or "/rider/request" if you move the form
          className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Request a new ride
        </button>
      </header>

      {/* Stats row (same idea as your screenshot) */}
      <div className="grid gap-3 md:grid-cols-5">
        <StatCard label="Active rides" value={activeCount} />
        <StatCard label="Upcoming rides" value={upcomingRides.length} />
        <StatCard label="Completed rides" value={completedRides.length} />
        <StatCard label="Cancelled rides" value={cancelledCount} />
        <StatCard label="Total bookings" value={totalBookings} />
      </div>

      {/* Tabs: Upcoming vs Completed */}
      <div className="mt-4">
        <div className="flex border-b border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab("UPCOMING")}
            className={
              "mr-4 border-b-2 px-2 pb-2 text-sm " +
              (activeTab === "UPCOMING"
                ? "border-slate-900 font-semibold text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700")
            }
          >
            Upcoming ({upcomingRides.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("COMPLETED")}
            className={
              "border-b-2 px-2 pb-2 text-sm " +
              (activeTab === "COMPLETED"
                ? "border-slate-900 font-semibold text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700")
            }
          >
            Completed ({completedRides.length})
          </button>
        </div>

        {/* Tab content */}
        <div className="pt-4">
          {activeTab === "UPCOMING" && (
            <UpcomingTabContent upcomingRides={upcomingRides} />
          )}

          {activeTab === "COMPLETED" && (
            <CompletedTabContent
              completedRides={completedFiltered}
              rawCompletedCount={completedRides.length}
              completedRange={completedRange}
              onChangeRange={setCompletedRange}
              completedSearch={completedSearch}
              onChangeSearch={setCompletedSearch}
            />
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------- Small shared components ---------- */

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold text-slate-900">
        {value}
      </p>
    </div>
  );
}

function UpcomingTabContent({ upcomingRides }: { upcomingRides: UpcomingRide[] }) {
  if (!upcomingRides.length) {
    return (
      <p className="text-sm text-slate-500">
        You have no upcoming rides. Use “Request a new ride” to book one.
      </p>
    );
  }

  // Replace with your actual Upcoming list component
  return (
    <div className="space-y-3">
      {/* <UpcomingRidesList rides={upcomingRides} /> */}
      {upcomingRides.map((ride) => (
        <div
          key={ride.id}
          className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
        >
          <div className="font-medium">
            {ride.pickupLabel} → {ride.dropoffLabel}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Departs{" "}
            {new Date(ride.departureTime).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

type CompletedTabContentProps = {
  completedRides: CompletedRide[];
  rawCompletedCount: number;
  completedRange: RangeFilter;
  onChangeRange: (r: RangeFilter) => void;
  completedSearch: string;
  onChangeSearch: (v: string) => void;
};

function CompletedTabContent({
  completedRides,
  rawCompletedCount,
  completedRange,
  onChangeRange,
  completedSearch,
  onChangeSearch,
}: CompletedTabContentProps) {
  return (
    <div className="space-y-3">
      {/* Filters row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Showing {completedRides.length} of {rawCompletedCount} completed rides
        </p>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="inline-flex rounded-full border border-slate-200 bg-white p-1">
            <FilterPill
              active={completedRange === "7D"}
              onClick={() => onChangeRange("7D")}
            >
              Last 7 days
            </FilterPill>
            <FilterPill
              active={completedRange === "30D"}
              onClick={() => onChangeRange("30D")}
            >
              Last 30 days
            </FilterPill>
            <FilterPill
              active={completedRange === "ALL"}
              onClick={() => onChangeRange("ALL")}
            >
              All time
            </FilterPill>
          </div>

          <input
            type="text"
            value={completedSearch}
            onChange={(e) => onChangeSearch(e.target.value)}
            placeholder="Search by address"
            className="w-48 rounded-full border border-slate-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* List */}
      {completedRides.length === 0 ? (
        <p className="text-sm text-slate-500">
          No completed rides match your filters.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Replace with your existing Completed list component if you have one */}
          {/* <CompletedRidesList rides={completedRides} /> */}
          {completedRides.map((ride) => (
            <div
              key={ride.id}
              className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
            >
              <div className="font-medium">
                {ride.pickupLabel} → {ride.dropoffLabel}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Completed{" "}
                {new Date(ride.completedAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full px-3 py-1 text-xs " +
        (active
          ? "bg-slate-900 text-white"
          : "text-slate-700 hover:bg-slate-100")
      }
    >
      {children}
    </button>
  );
}
