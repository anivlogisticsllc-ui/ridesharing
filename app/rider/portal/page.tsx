// app/rider/portal/page.tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type BookingStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "EXPIRED";
type PaymentType = "CARD" | "CASH";

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

  distanceMiles?: number | null;
  passengerCount?: number | null;
  tripStartedAt?: string | null;
  tripCompletedAt?: string | null;

  paymentType?: PaymentType | null;
  cashDiscountBps?: number | null;

  baseTotalPriceCents?: number | null;
  effectiveTotalPriceCents?: number | null;

  // legacy fallback
  totalPriceCents?: number | null;
};

type ApiResponse = { ok: true; bookings: Booking[] } | { ok: false; error: string };

type ConversationNotification = {
  conversationId: string;
  latestMessageId: string | null;
  latestMessageCreatedAt: string | null;
  latestMessageSenderId: string | null; // new
  senderType: "RIDER" | "DRIVER" | "UNKNOWN";
};

type CompletedFilter = "LAST_7" | "LAST_30" | "ALL" | "CUSTOM";

/* ---------- helpers ---------- */

function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

function isChatReadOnly(b: Booking): boolean {
  const completed = b.status === "COMPLETED" || b.rideStatus === "COMPLETED";
  const cancelledLike = b.status === "CANCELLED" || b.status === "EXPIRED";
  return completed || cancelledLike;
}

function getEffectiveFareCents(b: Booking): number | null {
  if (typeof b.effectiveTotalPriceCents === "number") return b.effectiveTotalPriceCents;
  if (typeof b.totalPriceCents === "number") return b.totalPriceCents;
  if (typeof b.baseTotalPriceCents === "number") return b.baseTotalPriceCents;
  return null;
}

// Dedupe: prefer real booking over ride-only
function dedupeByRideId(list: Booking[]): Booking[] {
  const map = new Map<string, Booking>();

  for (const b of list) {
    const existing = map.get(b.rideId);
    if (!existing) {
      map.set(b.rideId, b);
      continue;
    }

    const aHasBooking = !!existing.bookingId;
    const bHasBooking = !!b.bookingId;

    if (bHasBooking && !aHasBooking) {
      map.set(b.rideId, b);
      continue;
    }
    if (aHasBooking && !bHasBooking) continue;

    const score = (x: Booking) => {
      if (x.status === "COMPLETED" || x.rideStatus === "COMPLETED") return 30;
      if (x.rideStatus === "IN_ROUTE") return 20;
      if (x.status === "CONFIRMED") return 10;
      return 0;
    };

    if (score(b) > score(existing)) map.set(b.rideId, b);
  }

  return Array.from(map.values());
}

function PaymentBadge(props: { paymentType?: PaymentType | null; cashDiscountBps?: number | null }) {
  const pt = props.paymentType ?? null;
  const bps = props.cashDiscountBps ?? 0;

  if (!pt) return null;

  const isCash = pt === "CASH";
  const percent = isCash && bps ? Math.round(bps / 100) : 0;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 650,
        border: "1px solid " + (isCash ? "#bbf7d0" : "#d1d5db"),
        background: isCash ? "#ecfdf5" : "#f9fafb",
        color: isCash ? "#166534" : "#111827",
        marginTop: 6,
      }}
      title={isCash ? "Cash payment (discount applies)" : "Card payment"}
    >
      {pt}
      {isCash && percent > 0 ? <span style={{ fontWeight: 600, color: "#166534" }}>{percent}% off</span> : null}
    </span>
  );
}

/* ============================================
 *              MAIN PAGE
 * ==========================================*/

export default function RiderPortalPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [receiptBusyId, setReceiptBusyId] = useState<string | null>(null);

  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);

  const [activeChat, setActiveChat] = useState<{ conversationId: string; readOnly: boolean } | null>(null);

  const [chatNotifications, setChatNotifications] = useState<Record<string, number>>({});
  const [lastSeenMessageId, setLastSeenMessageId] = useState<Record<string, string | null>>({});

  const lastSeenRef = useRef<Record<string, string | null>>({});
  const activeChatRef = useRef<{ conversationId: string; readOnly: boolean } | null>(null);
  const bookingsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastVariant, setToastVariant] = useState<"success" | "error">("success");

  const [activeTab, setActiveTab] = useState<"UPCOMING" | "COMPLETED">("UPCOMING");
  const [completedFilter, setCompletedFilter] = useState<CompletedFilter>("LAST_30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [completedSearch, setCompletedSearch] = useState("");
  const [customFromDraft, setCustomFromDraft] = useState("");
  const [customToDraft, setCustomToDraft] = useState("");

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    lastSeenRef.current = lastSeenMessageId;
  }, [lastSeenMessageId]);

  /* ---------- Load bookings (initial + light polling) ---------- */

  async function refreshBookings(opts?: { silent?: boolean }) {
    const silent = opts?.silent ?? false;

    try {
      if (!silent) {
        setLoading(true);
        setError(null);
      }

      const res = await fetch("/api/rider/bookings", { method: "GET" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (!silent) setError(`Failed to load bookings. Status ${res.status}: ${text || "Unknown error"}`);
        return;
      }

      const data: ApiResponse = await res.json();
      if (!data.ok) {
        if (!silent) setError(data.error || "Failed to load bookings");
        return;
      }

      setBookings(dedupeByRideId(data.bookings));
    } catch (err) {
      console.error("Error fetching rider bookings:", err);
      if (!silent) setError("Unexpected error while loading bookings");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (cancelled) return;
      await refreshBookings({ silent: false });
    })();

    bookingsIntervalRef.current = setInterval(() => {
      refreshBookings({ silent: true });
    }, 25_000);

    return () => {
      cancelled = true;
      if (bookingsIntervalRef.current) clearInterval(bookingsIntervalRef.current);
      bookingsIntervalRef.current = null;
    };
  }, []);

/* ---------- Poll chat notifications ---------- */

useEffect(() => {
  let cancelled = false;

  async function pollChat() {
    try {
      const res = await fetch("/api/rider/chat-notifications", { method: "GET" });
      if (!res.ok) return;

      const data = (await res.json()) as
        | { ok: true; notifications: ConversationNotification[] }
        | { ok: false; error: string };

      if (cancelled || !data.ok) return;

      const notifications = data.notifications || [];
      const activeConvId = activeChatRef.current?.conversationId ?? null;

      // "Seen" means: last message id rider has acknowledged by opening/viewing chat.
      const seenMap = lastSeenRef.current || {};

      // Keep badges sticky: once unread=1, it stays 1 until rider opens chat.
      setChatNotifications((prev) => {
        let changed = false;
        const next = { ...prev };

        for (const n of notifications) {
          const convId = n.conversationId;
          const latestId = n.latestMessageId ?? null;

          // If chat is open for this conversation, always clear.
          if (activeConvId && convId === activeConvId) {
            if ((next[convId] ?? 0) !== 0) {
              next[convId] = 0;
              changed = true;
            }
            continue;
          }

          // If there is no latest message, no unread.
          if (!latestId) {
            if ((next[convId] ?? 0) !== 0) {
              next[convId] = 0;
              changed = true;
            }
            continue;
          }

          const lastSeenId = seenMap[convId] ?? null;

          // Only mark unread when:
          // - latest message is from DRIVER
          // - rider has not seen that message id yet
          const shouldBeUnread =
            n.senderType === "DRIVER" &&
            latestId !== lastSeenId;

          if (shouldBeUnread) {
            if ((next[convId] ?? 0) !== 1) {
              next[convId] = 1;
              changed = true;
            }
          } else {
            // IMPORTANT:
            // Do NOT force-clear if it's currently unread.
            // Example: driver sent msg (unread=1), rider replies (latest sender becomes RIDER),
            // but rider still hasn't opened chat -> keep unread badge.
            if ((next[convId] ?? 0) === 1) {
              // keep as-is
            } else if ((next[convId] ?? 0) !== 0) {
              next[convId] = 0;
              changed = true;
            } else {
              // already 0
            }
          }
        }

        return changed ? next : prev;
      });

      // Mark seen only while actively viewing the chat (optional but recommended)
      if (activeConvId) {
        const active = notifications.find((n) => n.conversationId === activeConvId);
        const latestId = active?.latestMessageId ?? null;

        if (latestId && (seenMap[activeConvId] ?? null) !== latestId) {
          const nextSeen = { ...seenMap, [activeConvId]: latestId };
          lastSeenRef.current = nextSeen;
          setLastSeenMessageId(nextSeen);
        }
      }
    } catch (err) {
      console.error("Error polling chat notifications:", err);
    }
  }

  pollChat();
  chatIntervalRef.current = setInterval(pollChat, 8_000);

  return () => {
    cancelled = true;
    if (chatIntervalRef.current) clearInterval(chatIntervalRef.current);
    chatIntervalRef.current = null;
  };
}, []);



  /* ---------- Unified openChat handler ---------- */

  function openChat(conversationId: string, readOnly: boolean) {
    setActiveChat({ conversationId, readOnly });

    // Clear the badge immediately
    setChatNotifications((prev) => ({ ...prev, [conversationId]: 0 }));

    // Mark as "seen" when opening chat:
    // We don't have the latest message id here directly.
    // Two options:
    //  1) Keep it as-is and let the next poll (active chat) mark seen to latestId (recommended).
    //  2) Or, if you store "last known latest id" separately, set it here.
    //
    // We'll do option #1 cleanly: keep lastSeen as-is on open,
    // and the poll (active chat branch) will update lastSeen to the current latestId.
  }


  /* ---------- Derived sets ---------- */

  const isCompletedBooking = (b: Booking) => b.status === "COMPLETED" || b.rideStatus === "COMPLETED";
  const isCancelledLike = (b: Booking) => b.status === "CANCELLED" || b.status === "EXPIRED";
  const now = new Date();

  const { activeRides, upcoming, completed } = useMemo(() => {
    const active = bookings.filter((b) => b.rideStatus === "IN_ROUTE");

    const upcomingRaw = bookings.filter(
      (b) => !isCompletedBooking(b) && !isCancelledLike(b) && b.rideStatus !== "IN_ROUTE"
    );

    const completedRaw = bookings.filter(isCompletedBooking);

    active.sort((a, b) => (safeDate(a.departureTime)?.getTime() ?? 0) - (safeDate(b.departureTime)?.getTime() ?? 0));
    upcomingRaw.sort(
      (a, b) => (safeDate(a.departureTime)?.getTime() ?? 0) - (safeDate(b.departureTime)?.getTime() ?? 0)
    );
    completedRaw.sort((a, b) => {
      const da = safeDate(a.tripCompletedAt || a.departureTime)?.getTime() ?? 0;
      const db = safeDate(b.tripCompletedAt || b.departureTime)?.getTime() ?? 0;
      return db - da;
    });

    return { activeRides: active, upcoming: upcomingRaw, completed: completedRaw };
  }, [bookings]);

  const cancelledCount = useMemo(() => bookings.filter((b) => b.status === "CANCELLED").length, [bookings]);
  const total = bookings.length;

  /* ---------- Completed filters & stats ---------- */

  function applyCustomRange() {
    setCompletedFilter("CUSTOM");
    setCustomFrom(customFromDraft);
    setCustomTo(customToDraft);
  }

  function clearCustomRange() {
    setCustomFromDraft("");
    setCustomToDraft("");
    setCustomFrom("");
    setCustomTo("");
  }

  function inDateRange(b: Booking): boolean {
    const completedDate = safeDate(b.tripCompletedAt) || safeDate(b.departureTime);
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
  const totalMiles = filteredCompleted.reduce((sum, b) => sum + (b.distanceMiles ?? 0), 0);

  const totalFareCents = filteredCompleted.reduce((sum, b) => {
    const cents = getEffectiveFareCents(b);
    return sum + (cents ?? 0);
  }, 0);

  const avgMiles = totalCompletedShown ? totalMiles / totalCompletedShown : 0;

  /* ---------- Actions ---------- */

  async function handleAction(bookingOrRideId: string, action: "cancel" | "complete") {
    try {
      setActionBusyId(bookingOrRideId);
      setError(null);

      const endpoint = action === "cancel" ? "/api/rider/bookings/cancel" : "/api/rider/bookings/complete";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: bookingOrRideId }),
      });

      const data: any = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setError(data?.error || `Failed to ${action} booking.`);
        return;
      }

      await refreshBookings({ silent: true });
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

  function handleExportCompletedCsv() {
    if (!filteredCompleted.length) return;

    const rows: string[][] = [
      ["Ride ID", "Booking ID", "From", "To", "Departure", "Distance (miles)", "Payment", "Base price", "Effective price", "Passengers"],
      ...filteredCompleted.map((b) => {
        const base = typeof b.baseTotalPriceCents === "number" ? `$${formatMoney(b.baseTotalPriceCents)}` : "";
        const effCents = getEffectiveFareCents(b);
        const eff = typeof effCents === "number" ? `$${formatMoney(effCents)}` : "";

        return [
          b.rideId,
          b.bookingId ?? "",
          b.originCity,
          b.destinationCity,
          new Date(b.departureTime).toLocaleString(),
          b.distanceMiles != null ? b.distanceMiles.toFixed(2) : "",
          b.paymentType ?? "",
          base,
          eff,
          b.passengerCount != null ? String(b.passengerCount) : "",
        ];
      }),
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
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
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
          <h1 style={{ fontSize: 30, fontWeight: 650, marginBottom: 6 }}>Rider portal</h1>
          <p style={{ margin: 0, color: "#555", maxWidth: 520, fontSize: 14 }}>
            Track your upcoming and completed rides, chat with drivers, and manage your trips.
          </p>
        </div>

        

        /* ... */

        <Link href="/">
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
        </Link>

      </header>

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
      {!loading && error && <p style={{ color: "red", marginBottom: 16 }}>{error}</p>}

      {!loading && !error && (
        <>
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
                borderBottom: activeTab === "UPCOMING" ? "2px solid #111827" : "2px solid transparent",
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
                borderBottom: activeTab === "COMPLETED" ? "2px solid #111827" : "2px solid transparent",
              }}
            >
              Completed ({completed.length})
            </button>
          </div>

          {activeTab === "UPCOMING" && (
            <section>
              <SectionHeader
                title="Upcoming rides"
                subtitle={activeRides.length > 0 ? "Your active and upcoming rides." : "Your next rides."}
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
                      <h3 style={{ margin: "8px 0 4px", fontSize: 14, fontWeight: 600 }}>Active ride</h3>

                      <RideList
                        bookings={activeRides}
                        allowChat
                        showActions
                        onCancel={(id) => handleAction(id, "cancel")}
                        onComplete={(bookingId) => handleAction(bookingId, "complete")}
                        actionBusyId={actionBusyId}
                        expandedBookingId={expandedBookingId}
                        onToggleExpand={(id) => setExpandedBookingId((curr) => (curr === id ? null : id))}
                        onOpenChat={openChat}
                        chatNotifications={chatNotifications}
                        onResendReceipt={handleResendReceipt}
                        receiptBusyId={receiptBusyId}
                      />

                      <div style={{ height: 16 }} />
                    </>
                  )}

                  {upcoming.length > 0 && (
                    <>
                      <h3 style={{ margin: "8px 0 4px", fontSize: 14, fontWeight: 600 }}>Upcoming rides</h3>

                      <RideList
                        bookings={upcoming}
                        allowChat
                        showActions
                        onCancel={(id) => handleAction(id, "cancel")}
                        onComplete={(bookingId) => handleAction(bookingId, "complete")}
                        actionBusyId={actionBusyId}
                        expandedBookingId={expandedBookingId}
                        onToggleExpand={(id) => setExpandedBookingId((curr) => (curr === id ? null : id))}
                        onOpenChat={openChat}
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

          {activeTab === "COMPLETED" && (
            <section>
              <SectionHeader title="Completed rides" subtitle="Your ride history and receipts." />

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
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 8, fontSize: 12 }}>
                  <MiniStat label="Rides shown" value={String(totalCompletedShown)} />
                  <MiniStat label="Total miles" value={totalMiles ? totalMiles.toFixed(2) : "0.00"} />
                  <MiniStat label="Total spent" value={totalFareCents ? `$${formatMoney(totalFareCents)}` : "$0.00"} />
                  <MiniStat label="Avg. miles / ride" value={avgMiles ? avgMiles.toFixed(2) : "0.00"} />
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <FilterPill label="Last 7 days" active={completedFilter === "LAST_7"} onClick={() => setCompletedFilter("LAST_7")} />
                  <FilterPill label="Last 30 days" active={completedFilter === "LAST_30"} onClick={() => setCompletedFilter("LAST_30")} />
                  <FilterPill label="All time" active={completedFilter === "ALL"} onClick={() => setCompletedFilter("ALL")} />
                  <FilterPill label="Custom" active={completedFilter === "CUSTOM"} onClick={() => setCompletedFilter("CUSTOM")} />

                  {completedFilter === "CUSTOM" && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11, alignItems: "center" }}>
                      <label>
                        <span style={{ marginRight: 4 }}>From</span>
                        <input
                          type="date"
                          value={customFromDraft}
                          onChange={(e) => setCustomFromDraft(e.target.value)}
                          style={{ borderRadius: 999, border: "1px solid #d1d5db", padding: "3px 8px", fontSize: 11 }}
                        />
                      </label>

                      <label>
                        <span style={{ marginRight: 4 }}>To</span>
                        <input
                          type="date"
                          value={customToDraft}
                          onChange={(e) => setCustomToDraft(e.target.value)}
                          style={{ borderRadius: 999, border: "1px solid #d1d5db", padding: "3px 8px", fontSize: 11 }}
                        />
                      </label>

                      <button
                        type="button"
                        onClick={applyCustomRange}
                        style={{
                          borderRadius: 999,
                          border: "1px solid #111827",
                          padding: "6px 10px",
                          fontSize: 12,
                          background: "#111827",
                          color: "#ffffff",
                          cursor: "pointer",
                        }}
                      >
                        Apply
                      </button>

                      <button
                        type="button"
                        onClick={clearCustomRange}
                        style={{
                          borderRadius: 999,
                          border: "1px solid #d1d5db",
                          padding: "6px 10px",
                          fontSize: 12,
                          background: "#ffffff",
                          color: "#111827",
                          cursor: "pointer",
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  )}

                  <div style={{ flex: 1 }} />

                  <input
                    type="text"
                    placeholder="Search by address"
                    value={completedSearch}
                    onChange={(e) => setCompletedSearch(e.target.value)}
                    style={{ minWidth: 220, borderRadius: 999, border: "1px solid #d1d5db", padding: "6px 10px", fontSize: 12 }}
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
                      background: filteredCompleted.length ? "#ffffff" : "#f3f4f6",
                      color: filteredCompleted.length ? "#111827" : "#9ca3af",
                      cursor: filteredCompleted.length ? "pointer" : "not-allowed",
                    }}
                  >
                    Export CSV
                  </button>
                </div>
              </div>

              {filteredCompleted.length === 0 ? (
                <p style={{ color: "#555", fontSize: 14 }}>No completed rides match this filter.</p>
              ) : (
                <RideList
                  bookings={filteredCompleted}
                  compact
                  allowChat
                  showActions={false}
                  expandedBookingId={expandedBookingId}
                  onToggleExpand={(id) => setExpandedBookingId((curr) => (curr === id ? null : id))}
                  onOpenChat={openChat}
                  chatNotifications={chatNotifications}
                  onResendReceipt={handleResendReceipt}
                  receiptBusyId={receiptBusyId}
                />
              )}
            </section>
          )}
        </>
      )}

      {activeChat && (
        <ChatOverlay conversationId={activeChat.conversationId} readOnly={activeChat.readOnly} onClose={() => setActiveChat(null)} />
      )}
    </main>
  );
}

/* ============================================
 *              SMALL UI HELPERS
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
      <div style={{ fontSize: 12, textTransform: "uppercase", color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function SectionHeader(props: { title: string; subtitle?: string }) {
  const { title, subtitle } = props;
  return (
    <div style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 650 }}>{title}</h2>
      {subtitle && <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>{subtitle}</p>}
    </div>
  );
}

function EmptyState(props: { message: string; actionLabel?: string; actionHref?: string }) {
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
    <div style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid #e5e7eb", background: "#ffffff" }}>
      <span style={{ fontSize: 11, color: "#6b7280", marginRight: 6 }}>{label}:</span>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function FilterPill(props: { label: string; active: boolean; onClick: () => void }) {
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
 *                RIDE LIST + TIMER + CHAT
 * ==========================================*/

function RideList(props: {
  bookings: Booking[];
  compact?: boolean;
  allowChat?: boolean;
  showActions?: boolean;
  onCancel?: (idForApi: string) => void;
  onComplete?: (bookingId: string) => void;
  actionBusyId?: string | null;
  expandedBookingId?: string | null;
  onToggleExpand?: (id: string) => void;
  onOpenChat?: (conversationId: string, readOnly: boolean) => void;
  chatNotifications?: Record<string, number>;
  onResendReceipt?: (bookingId: string) => void;
  receiptBusyId?: string | null;
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
        const isCompleted = b.status === "COMPLETED" || b.rideStatus === "COMPLETED";
        const isCancelled = b.status === "CANCELLED";
        const hasRealBooking = !!b.bookingId;

        const cancelKey = b.isRideOnly || !b.bookingId ? b.id : b.bookingId;
        const busy = actionBusyId != null && actionBusyId === cancelKey;

        const canChat = allowChat && !!b.conversationId;
        const unread = b.conversationId && chatNotifications ? chatNotifications[b.conversationId] ?? 0 : 0;

        const receiptBusy = receiptBusyId != null && hasRealBooking && receiptBusyId === b.bookingId;

        const effFare = getEffectiveFareCents(b);
        const dollars = typeof effFare === "number" ? formatMoney(effFare) : null;

        const distanceLabel =
          typeof b.distanceMiles === "number" && b.distanceMiles > 0 ? `${b.distanceMiles.toFixed(2)} miles` : null;

        const readOnly = isChatReadOnly(b);

        // ✅ Receipt should always go to /receipt/<bookingId> (never driver page)
        const openReceipt = () => {
          if (!b.bookingId) return;
          window.open(`/receipt/${encodeURIComponent(b.bookingId)}`, "_blank");
        };

        // ✅ Keep one primary action: Trip (always for any rideId)
        const goToTrip = () => {
          router.push(`/rider/trips/${encodeURIComponent(b.rideId)}`);
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
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
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
                  {dollars && ` • $${dollars}`}
                </div>

                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Booking: {b.status} · Ride: {b.rideStatus}
                  {b.isRideOnly && " (request pending)"}
                </div>

                {b.driverName && <div style={{ fontSize: 12, color: "#6b7280" }}>Driver: {b.driverName}</div>}

                <PaymentBadge paymentType={b.paymentType ?? null} cashDiscountBps={b.cashDiscountBps ?? null} />

                {isInRoute && (
                  <>
                    <div
                      style={{
                        display: "inline-block",
                        marginTop: 6,
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
                  minWidth: allowChat || showActions ? 220 : 0,
                }}
              >
                {/* ✅ Primary: Trip (always) */}
                <button
                  type="button"
                  onClick={goToTrip}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "1px solid #d1d5db",
                    background: "#ffffff",
                    fontSize: 13,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Trip
                </button>

                {/* ✅ Receipt only when completed + real booking */}
                {isCompleted && hasRealBooking && (
                  <button
                    type="button"
                    onClick={openReceipt}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: "1px solid #d1d5db",
                      background: "#ffffff",
                      fontSize: 13,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Receipt
                  </button>
                )}

                {/* ✅ Chat */}
                {allowChat && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!canChat || !onOpenChat || !b.conversationId) return;
                      onOpenChat(b.conversationId, readOnly);
                    }}
                    disabled={!canChat}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: canChat ? "1px solid #d1d5db" : "1px solid #e5e7eb",
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
                        ? `Chat (${unread} new)`
                        : readOnly
                        ? "Chat (read-only)"
                        : "Chat"
                      : "Chat not started"}
                  </button>
                )}

                {/* Actions only for upcoming/active lists */}
                {showActions && !isCancelled && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
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
                      onClick={() => onComplete && hasRealBooking && onComplete(b.bookingId!)}
                      disabled={!hasRealBooking || busy}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        border: "1px solid #bbf7d0",
                        background: hasRealBooking ? "#ecfdf5" : "#f9fafb",
                        fontSize: 12,
                        cursor: !hasRealBooking || busy ? "not-allowed" : "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {busy ? "Working..." : "Complete"}
                    </button>
                  </div>
                )}

                {/* Optional details (kept, but no extra “receipt”/driver links inside) */}
                <button
                  type="button"
                  onClick={() => onToggleExpand && onToggleExpand(b.id)}
                  style={{
                    marginTop: 2,
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: "none",
                    background: "#f3f4f6",
                    fontSize: 12,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {isExpanded ? "Hide details" : "Details"}
                </button>
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
                  <strong>Booking ID:</strong> {b.bookingId ?? "Not booked yet"}
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

                <div>
                  <strong>Payment:</strong> {b.paymentType ?? "n/a"}
                  {b.paymentType === "CASH" && (b.cashDiscountBps ?? 0) > 0 ? (
                    <span style={{ marginLeft: 8, color: "#166534", fontWeight: 600 }}>
                      ({Math.round((b.cashDiscountBps ?? 0) / 100)}% off)
                    </span>
                  ) : null}
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
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
                      {b.distanceMiles != null && (
                        <span>
                          <strong>Distance:</strong> {b.distanceMiles.toFixed(2)} mi
                        </span>
                      )}

                      {typeof b.baseTotalPriceCents === "number" && (
                        <span>
                          <strong>Base fare:</strong> ${formatMoney(b.baseTotalPriceCents)}
                        </span>
                      )}

                      {(() => {
                        const cents = getEffectiveFareCents(b);
                        return typeof cents === "number" ? (
                          <span>
                            <strong>Final fare:</strong> ${formatMoney(cents)}
                          </span>
                        ) : null;
                      })()}

                      {b.passengerCount != null && (
                        <span>
                          <strong>Passengers:</strong> {b.passengerCount}
                        </span>
                      )}
                      {b.tripStartedAt && (
                        <span>
                          <strong>Trip started:</strong> {new Date(b.tripStartedAt).toLocaleString()}
                        </span>
                      )}
                      {b.tripCompletedAt && (
                        <span>
                          <strong>Trip completed:</strong> {new Date(b.tripCompletedAt).toLocaleString()}
                        </span>
                      )}
                    </div>

                    {/* ✅ Only one secondary action here: resend receipt (optional) */}
                    {onResendReceipt && hasRealBooking && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                        <button
                          type="button"
                          onClick={() => b.bookingId && onResendReceipt(b.bookingId)}
                          disabled={receiptBusy}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 999,
                            border: "1px solid #0f766e",
                            background: "#0d9488",
                            color: "#ffffff",
                            fontSize: 12,
                            cursor: receiptBusy ? "not-allowed" : "pointer",
                          }}
                        >
                          {receiptBusy ? "Sending..." : "Resend receipt"}
                        </button>
                      </div>
                    )}
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
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");

  return (
    <span style={{ fontSize: 12, color: "#4b5563" }}>
      Trip time so far: <span style={{ fontWeight: 600 }}>{minutes}:{seconds}</span>
    </span>
  );
}

function ChatOverlay(props: { conversationId: string; readOnly: boolean; onClose: () => void }) {
  const { conversationId, readOnly, onClose } = props;

  const params = new URLSearchParams();
  if (readOnly) params.set("readonly", "1");
  const qs = params.toString();
  const src = qs ? `/chat/${conversationId}?${qs}` : `/chat/${conversationId}`;

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
          boxShadow: "0 20px 35px rgba(15,23,42,0.35), 0 0 0 1px rgba(148,163,184,0.15)",
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
          <span style={{ fontWeight: 600 }}>Chat with driver {readOnly ? "(read-only)" : ""}</span>
          <button
            type="button"
            onClick={onClose}
            style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
            aria-label="Close chat"
          >
            ×
          </button>
        </div>

        <iframe src={src} style={{ border: "none", width: "100%", height: "100%" }} title="Chat" />
      </div>
    </div>
  );
}
