"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

type Booking = {
  id: string; // UI id (real booking id OR synthetic "ride-<rideId>")
  bookingId: string | null; // REAL Booking row id (null for ride-only entries)

  status: BookingStatus;
  rideId: string;
  originCity: string;
  destinationCity: string;
  departureTime: string; // ISO string
  rideStatus: string;
  driverName: string | null;
  driverPublicId: string | null;
  conversationId: string | null;
  isRideOnly?: boolean;

  // Receipt-related fields
  distanceMiles?: number | null;
  totalPriceCents?: number | null;
  passengerCount?: number | null;
  tripStartedAt?: string | null;
  tripCompletedAt?: string | null;
};

type ApiResponse =
  | { ok: true; bookings: Booking[] }
  | { ok: false; error: string };

type ConversationNotification = {
  conversationId: string;
  latestMessageId: string | null;
  latestMessageCreatedAt: string | null;
  senderType: "RIDER" | "DRIVER" | "UNKNOWN";
};

type CompletedFilter = "LAST_7" | "LAST_30" | "ALL" | "CUSTOM";

/* ---------- Small helper functions ---------- */

function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

/* ============================================
 *           MAIN RIDER PORTAL PAGE
 * ==========================================*/

export default function RiderPortalPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // id used for API calls:
  // - real booking id (for normal bookings)
  // - "ride-<rideId>" (for ride-only "request pending" entries)
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [receiptBusyId, setReceiptBusyId] = useState<string | null>(null);

  const [expandedBookingId, setExpandedBookingId] =
    useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] =
    useState<string | null>(null);

  const [chatNotifications, setChatNotifications] = useState<
    Record<string, number>
  >({});
  const [lastSeenMessageId, setLastSeenMessageId] = useState<
    Record<string, string | null>
  >({});

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastVariant, setToastVariant] = useState<"success" | "error">(
    "success"
  );

  // UI state: tabs & completed filters
  const [activeTab, setActiveTab] = useState<"UPCOMING" | "COMPLETED">(
    "UPCOMING"
  );
  const [completedFilter, setCompletedFilter] =
    useState<CompletedFilter>("LAST_30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [completedSearch, setCompletedSearch] = useState("");

  /* ---------- Load bookings + lightweight polling ---------- */

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (!cancelled) {
          setLoading(true);
          setError(null);
        }

        const res = await fetch("/api/rider/bookings", { method: "GET" });

        if (!res.ok) {
          const text = await res.text();
          if (!cancelled) {
            setError(
              `Failed to load bookings. Status ${res.status}: ${
                text || "Unknown error"
              }`
            );
          }
          return;
        }

        const data: ApiResponse = await res.json();
        if (!data.ok) {
          if (!cancelled) setError(data.error || "Failed to load bookings");
          return;
        }

        if (!cancelled) setBookings(data.bookings);
      } catch (err) {
        console.error("Error fetching rider bookings:", err);
        if (!cancelled) setError("Unexpected error while loading bookings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // initial load
    load();

    // light polling so driver-side changes appear automatically
    const intervalId = setInterval(load, 10_000); // every 10 seconds

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  /* ---------- Poll chat notifications ---------- */

  useEffect(() => {
    let cancelled = false;
    let intervalId: any = null;

    async function poll() {
      try {
        const res = await fetch("/api/rider/chat-notifications");
        if (!res.ok) return;

        const data = (await res.json()) as
          | { ok: true; notifications: ConversationNotification[] }
          | { ok: false; error: string };

        if (!("ok" in data) || !data.ok || cancelled) return;

        const notificationsRaw = data.notifications;
        const badgeMap: Record<string, number> = {};

        setLastSeenMessageId((prev) => {
          const next: Record<string, string | null> = { ...prev };

          for (const n of notificationsRaw) {
            const convId = n.conversationId;
            const newId = n.latestMessageId;
            const prevId = prev[convId];

            if (!newId) {
              if (!(convId in next)) next[convId] = null;
              continue;
            }

            const isNewDriverMessage =
              n.senderType === "DRIVER" && newId !== prevId;

            if (isNewDriverMessage) {
              badgeMap[convId] = 1;
            } else if (badgeMap[convId] == null) {
              badgeMap[convId] = 0;
            }

            next[convId] = newId;
          }

          return next;
        });

        if (!cancelled) {
          setChatNotifications((prevBadges) => ({
            ...prevBadges,
            ...badgeMap,
          }));
        }
      } catch (err) {
        console.error("Error polling chat notifications:", err);
      }
    }

    poll();
    intervalId = setInterval(poll, 8000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  /* ---------- Derived sets (with sorting) ---------- */

  const isCompletedBooking = (b: Booking) =>
    b.status === "COMPLETED" || b.rideStatus === "COMPLETED";

  const isCancelledLike = (b: Booking) =>
    b.status === "CANCELLED" || b.status === "EXPIRED";

  const now = useMemo(() => new Date(), []);

  const { activeRides, upcoming, completed } = useMemo(() => {
    const active = bookings.filter((b) => b.rideStatus === "IN_ROUTE");

    const upcomingRaw = bookings.filter(
      (b) =>
        !isCompletedBooking(b) &&
        !isCancelledLike(b) &&
        b.rideStatus !== "IN_ROUTE"
    );

    const completedRaw = bookings.filter(isCompletedBooking);

    // Sort active and upcoming by departure time ASC
    active.sort((a, b) => {
      const da = safeDate(a.departureTime)?.getTime() ?? 0;
      const db = safeDate(b.departureTime)?.getTime() ?? 0;
      return da - db;
    });

    upcomingRaw.sort((a, b) => {
      const da = safeDate(a.departureTime)?.getTime() ?? 0;
      const db = safeDate(b.departureTime)?.getTime() ?? 0;
      return da - db;
    });

    // Completed sorted by tripCompletedAt DESC, fallback to departure DESC
    completedRaw.sort((a, b) => {
      const da =
        safeDate(a.tripCompletedAt || a.departureTime)?.getTime() ?? 0;
      const db =
        safeDate(b.tripCompletedAt || b.departureTime)?.getTime() ?? 0;
      return db - da;
    });

    return {
      activeRides: active,
      upcoming: upcomingRaw,
      completed: completedRaw,
    };
  }, [bookings]);

  const cancelledCount = useMemo(
    () => bookings.filter((b) => b.status === "CANCELLED").length,
    [bookings]
  );

  const total = bookings.length;

  /* ---------- Completed list filters & stats ---------- */

  function inDateRange(b: Booking): boolean {
    const completedDate =
      safeDate(b.tripCompletedAt) || safeDate(b.departureTime);
    if (!completedDate) return true;

    if (completedFilter === "LAST_7") {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 7);
      return completedDate >= cutoff && completedDate <= now;
    }

    if (completedFilter === "LAST_30") {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 30);
      return completedDate >= cutoff && completedDate <= now;
    }

    if (completedFilter === "CUSTOM") {
      if (!customFrom && !customTo) return true;

      let from = customFrom ? new Date(customFrom) : null;
      let to = customTo ? new Date(customTo) : null;

      if (from && Number.isNaN(from.getTime())) from = null;
      if (to && Number.isNaN(to.getTime())) to = null;

      if (from && completedDate < from) return false;
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        if (completedDate > end) return false;
      }
      return true;
    }

    // ALL
    return true;
  }

  const normalizedSearch = completedSearch.trim().toLowerCase();

  const filteredCompleted = useMemo(
    () =>
      completed.filter((b) => {
        if (!inDateRange(b)) return false;

        if (normalizedSearch) {
          const text = `${b.originCity} ${b.destinationCity}`.toLowerCase();
          if (!text.includes(normalizedSearch)) return false;
        }

        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [completed, completedFilter, customFrom, customTo, completedSearch]
  );

  const totalCompletedShown = filteredCompleted.length;
  const totalMiles = filteredCompleted.reduce(
    (sum, b) => sum + (b.distanceMiles ?? 0),
    0
  );
  const totalFareCents = filteredCompleted.reduce(
    (sum, b) => sum + (b.totalPriceCents ?? 0),
    0
  );
  const avgMiles = totalCompletedShown ? totalMiles / totalCompletedShown : 0;

  /* ---------- Actions ---------- */

  /**
   * bookingOrRideId:
   *   - real booking id for normal bookings
   *   - "ride-<rideId>" for ride-only "request pending" entries
   */
  async function handleAction(
    bookingOrRideId: string,
    action: "cancel" | "complete"
  ) {
    try {
      setActionBusyId(bookingOrRideId);
      setError(null);

      const endpoint =
        action === "cancel"
          ? "/api/rider/bookings/cancel"
          : "/api/rider/bookings/complete";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: bookingOrRideId }),
      });

      if (!res.ok) {
        let msg = `Failed to ${action} booking.`;
        try {
          const data = await res.json();
          if (data?.error) msg = data.error;
        } catch (e) {
          console.error("Non-JSON error from action endpoint:", e);
        }
        setError(msg);
        return;
      }

      const data: any = await res.json();
      if (!data?.ok) {
        setError(data?.error || `Failed to ${action} booking.`);
        return;
      }

      // Synthetic "ride-<id>" => remove that entry
      if (action === "cancel" && bookingOrRideId.startsWith("ride-")) {
        setBookings((prev) => prev.filter((b) => b.id !== bookingOrRideId));
        return;
      }

      // Real booking id: update in-place
      setBookings((prev) =>
        prev.map((b) =>
          b.bookingId === bookingOrRideId
            ? {
                ...b,
                status:
                  action === "cancel"
                    ? ("CANCELLED" as BookingStatus)
                    : ("COMPLETED" as BookingStatus),
              }
            : b
        )
      );
    } catch (err) {
      console.error(`Error trying to ${action} booking:`, err);
      setError(`Unexpected error while trying to ${action} booking.`);
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleResendReceipt(bookingId: string) {
    try {
      setReceiptBusyId(bookingId);
      setToastMessage(null);

      const res = await fetch("/api/rider/resend-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });

      if (!res.ok) {
        setToastVariant("error");
        setToastMessage("Failed to resend receipt.");
        return;
      }

      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setToastVariant("error");
        setToastMessage(data.error || "Failed to resend receipt.");
        return;
      }

      setToastVariant("success");
      setToastMessage("Receipt sent to your email.");
    } catch (err) {
      console.error("Error resending receipt:", err);
      setToastVariant("error");
      setToastMessage("Failed to resend receipt.");
    } finally {
      setReceiptBusyId(null);
    }
  }

  // Export CSV for completed rides (current filter)
  function handleExportCompletedCsv() {
    if (!filteredCompleted.length) return;

    const rows: string[][] = [
      [
        "Ride ID",
        "Booking ID",
        "From",
        "To",
        "Departure",
        "Distance (miles)",
        "Total price",
        "Passengers",
      ],
      ...filteredCompleted.map((b) => [
        b.rideId,
        b.bookingId ?? "",
        b.originCity,
        b.destinationCity,
        new Date(b.departureTime).toLocaleString(),
        b.distanceMiles != null ? b.distanceMiles.toFixed(2) : "",
        b.totalPriceCents != null ? `$${formatMoney(b.totalPriceCents)}` : "",
        b.passengerCount != null ? String(b.passengerCount) : "",
      ]),
    ];

    const csv = rows
      .map((row) =>
        row
          .map((cell) => {
            const escaped = String(cell ?? "").replace(/"/g, '""');
            return `"${escaped}"`;
          })
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "completed-rides.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /* ---------- Render ---------- */

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "24px 16px 40px",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Top header */}
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 30,
              fontWeight: 650,
              marginBottom: 6,
            }}
          >
            Rider portal
          </h1>
          <p
            style={{
              margin: 0,
              color: "#555",
              maxWidth: 520,
              fontSize: 14,
            }}
          >
            Track your upcoming and completed rides, chat with drivers, and
            manage your trips.
          </p>
        </div>

        <a href="/">
          <button
            type="button"
            style={{
              padding: "10px 18px",
              borderRadius: 999,
              border: "none",
              background: "#4f46e5",
              color: "#fff",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Request a new ride
          </button>
        </a>
      </header>

      {/* Summary cards */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <SummaryCard label="Active rides" value={activeRides.length} />
        <SummaryCard label="Upcoming rides" value={upcoming.length} />
        <SummaryCard label="Completed rides" value={completed.length} />
        <SummaryCard label="Cancelled rides" value={cancelledCount} />
        <SummaryCard label="Total bookings" value={total} />
      </section>

      {/* Toast for receipt actions */}
      {toastMessage && (
        <p
          style={{
            margin: "4px 0 16px",
            fontSize: 14,
            color: toastVariant === "success" ? "#15803d" : "#dc2626",
          }}
        >
          {toastMessage}
        </p>
      )}

      {loading && <p>Loading your bookings...</p>}

      {!loading && error && (
        <p style={{ color: "red", marginBottom: 16 }}>{error}</p>
      )}

      {!loading && !error && (
        <>
          {/* Tabs */}
          <div
            style={{
              display: "flex",
              gap: 16,
              borderBottom: "1px solid #e5e7eb",
              marginBottom: 16,
              marginTop: 4,
              fontSize: 14,
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab("UPCOMING")}
              style={{
                border: "none",
                background: "transparent",
                padding: "6px 0",
                cursor: "pointer",
                fontWeight: activeTab === "UPCOMING" ? 600 : 500,
                color: activeTab === "UPCOMING" ? "#111827" : "#6b7280",
                borderBottom:
                  activeTab === "UPCOMING"
                    ? "2px solid #111827"
                    : "2px solid transparent",
              }}
            >
              Upcoming ({upcoming.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("COMPLETED")}
              style={{
                border: "none",
                background: "transparent",
                padding: "6px 0",
                cursor: "pointer",
                fontWeight: activeTab === "COMPLETED" ? 600 : 500,
                color: activeTab === "COMPLETED" ? "#111827" : "#6b7280",
                borderBottom:
                  activeTab === "COMPLETED"
                    ? "2px solid #111827"
                    : "2px solid transparent",
              }}
            >
              Completed ({completed.length})
            </button>
          </div>

          {/* UPCOMING TAB */}
          {activeTab === "UPCOMING" && (
            <section>
              <SectionHeader
                title="Upcoming rides"
                subtitle={
                  activeRides.length > 0
                    ? "Your active and upcoming rides."
                    : "Your next rides."
                }
              />

              {activeRides.length > 0 && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "8px 12px",
                    borderRadius: 999,
                    background: "#ecfdf5",
                    border: "1px solid #bbf7d0",
                    fontSize: 12,
                    color: "#166534",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 6,
                      height: 6,
                      borderRadius: "999px",
                      backgroundColor: "#22c55e",
                      marginRight: 6,
                    }}
                  />
                  Your driver is on the way for an active trip.
                </div>
              )}

              {upcoming.length === 0 && activeRides.length === 0 ? (
                <EmptyState message="You have no upcoming rides." />
              ) : (
                <>
                  {activeRides.length > 0 && (
                    <>
                      <h3
                        style={{
                          margin: "8px 0 4px",
                          fontSize: 14,
                          fontWeight: 600,
                        }}
                      >
                        Active ride
                      </h3>
                      <RideList
                        bookings={activeRides}
                        allowChat
                        showActions
                        onCancel={(id) => handleAction(id, "cancel")}
                        onComplete={(bookingId) =>
                          handleAction(bookingId, "complete")
                        }
                        actionBusyId={actionBusyId}
                        expandedBookingId={expandedBookingId}
                        onToggleExpand={(id) =>
                          setExpandedBookingId((curr) =>
                            curr === id ? null : id
                          )
                        }
                        onOpenChat={(conversationId) => {
                          setActiveConversationId(conversationId);
                          setChatNotifications((prev) => ({
                            ...prev,
                            [conversationId]: 0,
                          }));
                        }}
                        chatNotifications={chatNotifications}
                        onResendReceipt={handleResendReceipt}
                        receiptBusyId={receiptBusyId}
                      />
                      <div style={{ height: 16 }} />
                    </>
                  )}

                  {upcoming.length > 0 && (
                    <>
                      <h3
                        style={{
                          margin: "8px 0 4px",
                          fontSize: 14,
                          fontWeight: 600,
                        }}
                      >
                        Upcoming rides
                      </h3>
                      <RideList
                        bookings={upcoming}
                        allowChat
                        showActions
                        onCancel={(id) => handleAction(id, "cancel")}
                        onComplete={(bookingId) =>
                          handleAction(bookingId, "complete")
                        }
                        actionBusyId={actionBusyId}
                        expandedBookingId={expandedBookingId}
                        onToggleExpand={(id) =>
                          setExpandedBookingId((curr) =>
                            curr === id ? null : id
                          )
                        }
                        onOpenChat={(conversationId) => {
                          setActiveConversationId(conversationId);
                          setChatNotifications((prev) => ({
                            ...prev,
                            [conversationId]: 0,
                          }));
                        }}
                        chatNotifications={chatNotifications}
                        onResendReceipt={handleResendReceipt}
                        receiptBusyId={receiptBusyId}
                      />
                    </>
                  )}
                </>
              )}
            </section>
          )}

          {/* COMPLETED TAB */}
          {activeTab === "COMPLETED" && (
            <section>
              <SectionHeader
                title="Completed rides"
                subtitle="Your ride history and receipts."
              />

              {/* Stats + filters bar (sticky) */}
              <div
                style={{
                  position: "sticky",
                  top: 56,
                  zIndex: 10,
                  background: "#f9fafb",
                  padding: "8px 0 10px",
                  marginBottom: 8,
                }}
              >
                {/* Stats */}
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 12,
                    marginBottom: 8,
                    fontSize: 12,
                  }}
                >
                  <MiniStat
                    label="Rides shown"
                    value={String(totalCompletedShown)}
                  />
                  <MiniStat
                    label="Total miles"
                    value={totalMiles ? totalMiles.toFixed(2) : "0.00"}
                  />
                  <MiniStat
                    label="Total spent"
                    value={
                      totalFareCents
                        ? `$${formatMoney(totalFareCents)}`
                        : "$0.00"
                    }
                  />
                  <MiniStat
                    label="Avg. miles / ride"
                    value={avgMiles ? avgMiles.toFixed(2) : "0.00"}
                  />
                </div>

                {/* Filters */}
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <FilterPill
                    label="Last 7 days"
                    active={completedFilter === "LAST_7"}
                    onClick={() => setCompletedFilter("LAST_7")}
                  />
                  <FilterPill
                    label="Last 30 days"
                    active={completedFilter === "LAST_30"}
                    onClick={() => setCompletedFilter("LAST_30")}
                  />
                  <FilterPill
                    label="All time"
                    active={completedFilter === "ALL"}
                    onClick={() => setCompletedFilter("ALL")}
                  />
                  <FilterPill
                    label="Custom"
                    active={completedFilter === "CUSTOM"}
                    onClick={() => setCompletedFilter("CUSTOM")}
                  />

                  {completedFilter === "CUSTOM" && (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        fontSize: 11,
                      }}
                    >
                      <label>
                        <span style={{ marginRight: 4 }}>From</span>
                        <input
                          type="date"
                          value={customFrom}
                          onChange={(e) => setCustomFrom(e.target.value)}
                          style={{
                            borderRadius: 999,
                            border: "1px solid #d1d5db",
                            padding: "3px 8px",
                            fontSize: 11,
                          }}
                        />
                      </label>
                      <label>
                        <span style={{ marginRight: 4 }}>To</span>
                        <input
                          type="date"
                          value={customTo}
                          onChange={(e) => setCustomTo(e.target.value)}
                          style={{
                            borderRadius: 999,
                            border: "1px solid #d1d5db",
                            padding: "3px 8px",
                            fontSize: 11,
                          }}
                        />
                      </label>
                    </div>
                  )}

                  <div style={{ flex: 1 }} />

                  <input
                    type="text"
                    placeholder="Search by address"
                    value={completedSearch}
                    onChange={(e) => setCompletedSearch(e.target.value)}
                    style={{
                      minWidth: 220,
                      borderRadius: 999,
                      border: "1px solid #d1d5db",
                      padding: "6px 10px",
                      fontSize: 12,
                    }}
                  />

                  <button
                    type="button"
                    onClick={handleExportCompletedCsv}
                    disabled={!filteredCompleted.length}
                    style={{
                      borderRadius: 999,
                      border: "1px solid #d1d5db",
                      padding: "6px 10px",
                      fontSize: 12,
                      background: filteredCompleted.length
                        ? "#ffffff"
                        : "#f3f4f6",
                      color: filteredCompleted.length
                        ? "#111827"
                        : "#9ca3af",
                      cursor: filteredCompleted.length
                        ? "pointer"
                        : "not-allowed",
                    }}
                  >
                    Export CSV
                  </button>
                </div>
              </div>

              {filteredCompleted.length === 0 ? (
                <p style={{ color: "#555", fontSize: 14 }}>
                  No completed rides match this filter.
                </p>
              ) : (
                <RideList
                  bookings={filteredCompleted}
                  compact
                  allowChat
                  showActions={false}
                  expandedBookingId={expandedBookingId}
                  onToggleExpand={(id) =>
                    setExpandedBookingId((curr) => (curr === id ? null : id))
                  }
                  onOpenChat={(conversationId) => {
                    setActiveConversationId(conversationId);
                    setChatNotifications((prev) => ({
                      ...prev,
                      [conversationId]: 0,
                    }));
                  }}
                  chatNotifications={chatNotifications}
                  onResendReceipt={handleResendReceipt}
                  receiptBusyId={receiptBusyId}
                />
              )}
            </section>
          )}
        </>
      )}

      {activeConversationId && (
        <ChatOverlay
          conversationId={activeConversationId}
          onClose={() => setActiveConversationId(null)}
        />
      )}
    </main>
  );
}

/* ============================================
 *                SMALL UI HELPERS
 * ==========================================*/

function SummaryCard(props: { label: string; value: number }) {
  const { label, value } = props;
  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid #e5e7eb",
        padding: "12px 14px",
        background: "#f9fafb",
        minHeight: 70,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          fontSize: 12,
          textTransform: "uppercase",
          color: "#6b7280",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function SectionHeader(props: { title: string; subtitle?: string }) {
  const { title, subtitle } = props;
  return (
    <div style={{ marginBottom: 8 }}>
      <h2
        style={{
          margin: 0,
          fontSize: 20,
          fontWeight: 650,
        }}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "#6b7280",
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

function EmptyState(props: {
  message: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  const { message, actionLabel, actionHref } = props;
  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px dashed #e5e7eb",
        padding: 16,
        background: "#f9fafb",
        fontSize: 14,
        color: "#4b5563",
      }}
    >
      <p style={{ margin: 0, marginBottom: actionLabel ? 8 : 0 }}>{message}</p>
      {actionLabel && actionHref && (
        <a href={actionHref}>
          <button
            type="button"
            style={{
              marginTop: 4,
              padding: "6px 12px",
              borderRadius: 999,
              border: "1px solid #d1d5db",
              background: "#fff",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {actionLabel}
          </button>
        </a>
      )}
    </div>
  );
}

function MiniStat(props: { label: string; value: string }) {
  const { label, value } = props;
  return (
    <div
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid #e5e7eb",
        background: "#ffffff",
      }}
    >
      <span style={{ fontSize: 11, color: "#6b7280", marginRight: 6 }}>
        {label}:
      </span>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function FilterPill(props: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const { label, active, onClick } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: active ? "1px solid #111827" : "1px solid #d1d5db",
        background: active ? "#111827" : "#ffffff",
        color: active ? "#ffffff" : "#111827",
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

/* ============================================
 *        RIDE LIST + TIMER + CHAT OVERLAY
 * ==========================================*/

function RideList(props: {
  bookings: Booking[];
  compact?: boolean;
  allowChat?: boolean;
  showActions?: boolean;
  onCancel?: (idForApi: string) => void;
  onComplete?: (bookingId: string) => void;
  actionBusyId?: string | null; // id used for API call
  expandedBookingId?: string | null; // list id
  onToggleExpand?: (id: string) => void;
  onOpenChat?: (conversationId: string) => void;
  chatNotifications?: Record<string, number>;
  onResendReceipt?: (bookingId: string) => void;
  receiptBusyId?: string | null; // bookingId
}) {
  const {
    bookings,
    allowChat = false,
    showActions = false,
    onCancel,
    onComplete,
    actionBusyId,
    expandedBookingId,
    onToggleExpand,
    onOpenChat,
    chatNotifications,
    onResendReceipt,
    receiptBusyId,
  } = props;

  const router = useRouter();

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {bookings.map((b) => {
        const dt = safeDate(b.departureTime) ?? new Date(b.departureTime);
        const isExpanded = expandedBookingId === b.id;
        const isInRoute = b.rideStatus === "IN_ROUTE";
        const isCompleted = b.status === "COMPLETED";
        const isCancelled = b.status === "CANCELLED";
        const hasRealBooking = !!b.bookingId;

        // For cancel:
        // - if ride-only: we use b.id (e.g. "ride-<rideId>")
        // - if normal booking: we use b.bookingId
        const cancelKey = b.isRideOnly || !b.bookingId ? b.id : b.bookingId;
        const busy = actionBusyId != null && actionBusyId === cancelKey;

        const canChat = allowChat && !!b.conversationId;
        const unread =
          b.conversationId && chatNotifications
            ? chatNotifications[b.conversationId] ?? 0
            : 0;

        const receiptBusy =
          receiptBusyId != null &&
          hasRealBooking &&
          receiptBusyId === b.bookingId;

        const dollars =
          typeof b.totalPriceCents === "number"
            ? (b.totalPriceCents / 100).toFixed(2)
            : null;

        const distanceLabel =
          typeof b.distanceMiles === "number" && b.distanceMiles > 0
            ? `${b.distanceMiles.toFixed(2)} miles`
            : null;

        const handlePrintReceipt = () => {
          if (!b.rideId) return;
          window.open(`/driver/rides/${b.rideId}`, "_blank");
        };

        return (
          <li
            key={b.id}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: 12,
              marginBottom: 10,
              background: isCancelled ? "#fef2f2" : "#ffffff",
              opacity: isCancelled ? 0.85 : 1,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    marginBottom: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {b.originCity} → {b.destinationCity}
                </div>
                <div style={{ fontSize: 13, color: "#4b5563" }}>
                  Departure: {dt.toLocaleString()}
                  {distanceLabel && ` • ${distanceLabel}`}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Booking: {b.status} · Ride: {b.rideStatus}
                  {b.isRideOnly && " (request pending)"}
                </div>

                {b.driverName && (
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    Driver: {b.driverName}
                  </div>
                )}

                {isInRoute && (
                  <>
                    <div
                      style={{
                        display: "inline-block",
                        marginTop: 4,
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 600,
                        backgroundColor: "#dcfce7",
                        color: "#166534",
                      }}
                    >
                      In route (active now)
                    </div>

                    {b.tripStartedAt && (
                      <div style={{ marginTop: 4 }}>
                        <InRouteTimer startedAt={b.tripStartedAt} />
                      </div>
                    )}
                  </>
                )}

                {isCancelled && (
                  <div
                    style={{
                      display: "inline-block",
                      marginTop: 4,
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 600,
                      backgroundColor: "#fee2e2",
                      color: "#b91c1c",
                    }}
                  >
                    Cancelled
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "flex-end",
                  gap: 6,
                  minWidth: allowChat || showActions ? 210 : 0,
                }}
              >
                {allowChat && (
                  <button
                    type="button"
                    onClick={() =>
                      canChat &&
                      onOpenChat &&
                      b.conversationId &&
                      onOpenChat(b.conversationId)
                    }
                    disabled={!canChat}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: canChat
                        ? "1px solid #d1d5db"
                        : "1px solid #e5e7eb",
                      background: canChat ? "#ffffff" : "#f9fafb",
                      fontSize: 13,
                      color: canChat ? "#111827" : "#9ca3af",
                      cursor: canChat ? "pointer" : "not-allowed",
                      whiteSpace: "nowrap",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: 6,
                        height: 6,
                        borderRadius: "999px",
                        backgroundColor: canChat ? "#22c55e" : "#d1d5db",
                      }}
                    />
                    {canChat
                      ? unread > 0
                        ? `View chat (${unread} new)`
                        : "View chat"
                      : "Chat not started"}
                  </button>
                )}

                {showActions && !isCancelled && (
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                      justifyContent: "flex-end",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onCancel && onCancel(cancelKey)}
                      disabled={busy}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        border: "1px solid #fecaca",
                        background: "#fef2f2",
                        fontSize: 12,
                        cursor: busy ? "not-allowed" : "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {busy ? "Working..." : "Cancel"}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onComplete && hasRealBooking && onComplete(b.bookingId!)
                      }
                      disabled={!hasRealBooking || busy}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        border: "1px solid #bbf7d0",
                        background: hasRealBooking ? "#ecfdf5" : "#f9fafb",
                        fontSize: 12,
                        cursor:
                          !hasRealBooking || busy ? "not-allowed" : "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {busy ? "Working..." : "Complete"}
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => onToggleExpand && onToggleExpand(b.id)}
                  style={{
                    marginTop: 4,
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: "none",
                    background: "#f3f4f6",
                    fontSize: 12,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {isExpanded ? "Hide details" : "View ride details"}
                </button>

                {(b.status === "COMPLETED" || b.rideStatus === "IN_ROUTE") && (
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        `/rider/trips/${encodeURIComponent(b.rideId)}`
                      )
                    }
                    style={{
                      marginTop: 4,
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: "1px solid #d1d5db",
                      background: "#ffffff",
                      fontSize: 12,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Open full trip page
                  </button>
                )}
              </div>
            </div>

            {isExpanded && (
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 8,
                  borderTop: "1px solid #e5e7eb",
                  fontSize: 13,
                  color: "#4b5563",
                }}
              >
                <div>
                  <strong>Ride ID:</strong> {b.rideId}
                </div>
                <div>
                  <strong>Booking ID:</strong>{" "}
                  {b.bookingId ?? "Not booked yet"}
                </div>
                {b.driverPublicId && (
                  <div>
                    <strong>Driver public ID:</strong> {b.driverPublicId}
                  </div>
                )}
                <div>
                  <strong>Status:</strong> {b.status} / {b.rideStatus}
                </div>
                <div>
                  <strong>Departure time:</strong> {dt.toLocaleString()}
                </div>

                {isCompleted && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid #e5e7eb",
                      background: "#f9fafb",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      {b.distanceMiles != null && (
                        <span>
                          <strong>Distance:</strong>{" "}
                          {b.distanceMiles.toFixed(2)} mi
                        </span>
                      )}
                      {dollars && (
                        <span>
                          <strong>Fare:</strong> ${dollars}
                        </span>
                      )}
                      {b.passengerCount != null && (
                        <span>
                          <strong>Passengers:</strong> {b.passengerCount}
                        </span>
                      )}
                      {b.tripStartedAt && (
                        <span>
                          <strong>Trip started:</strong>{" "}
                          {new Date(b.tripStartedAt).toLocaleString()}
                        </span>
                      )}
                      {b.tripCompletedAt && (
                        <span>
                          <strong>Trip completed:</strong>{" "}
                          {new Date(b.tripCompletedAt).toLocaleString()}
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        marginTop: 8,
                      }}
                    >
                      <button
                        type="button"
                        onClick={handlePrintReceipt}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 999,
                          border: "1px solid #d1d5db",
                          background: "#ffffff",
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        Print receipt
                      </button>

                      {onResendReceipt && hasRealBooking && (
                        <button
                          type="button"
                          onClick={() =>
                            onResendReceipt &&
                            b.bookingId &&
                            onResendReceipt(b.bookingId)
                          }
                          disabled={!hasRealBooking || receiptBusy}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 999,
                            border: "1px solid #0f766e",
                            background: hasRealBooking
                              ? "#0d9488"
                              : "#9ca3af",
                            color: "#ffffff",
                            fontSize: 12,
                            cursor:
                              !hasRealBooking || receiptBusy
                                ? "not-allowed"
                                : "pointer",
                          }}
                        >
                          {receiptBusy ? "Sending..." : "Resend receipt"}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function InRouteTimer(props: { startedAt: string }) {
  const { startedAt } = props;
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const start = safeDate(startedAt) ?? new Date(startedAt);
  const diffMs = Math.max(0, now.getTime() - start.getTime());
  const totalSeconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");

  return (
    <span style={{ fontSize: 12, color: "#4b5563" }}>
      Trip time so far:{" "}
      <span style={{ fontWeight: 600 }}>
        {minutes}:{seconds}
      </span>
    </span>
  );
}

function ChatOverlay(props: { conversationId: string; onClose: () => void }) {
  const { conversationId, onClose } = props;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: "min(900px, 100%)",
          height: "min(650px, 100%)",
          background: "#fff",
          borderRadius: 16,
          boxShadow:
            "0 20px 35px rgba(15,23,42,0.35), 0 0 0 1px rgba(148,163,184,0.15)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 14,
          }}
        >
          <span style={{ fontWeight: 600 }}>Chat with driver</span>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
            }}
            aria-label="Close chat"
          >
            ×
          </button>
        </div>

        <iframe
          src={`/chat/${conversationId}`}
          style={{
            border: "none",
            width: "100%",
            height: "100%",
          }}
          title="Chat"
        />
      </div>
    </div>
  );
}
