"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type BookingStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "EXPIRED";
type PaymentType = "CARD" | "CASH";

type Booking = {
  id: string; // UI id (booking id OR synthetic "ride-<rideId>")
  bookingId: string | null; // REAL Booking id (null for ride-only entries)

  status: BookingStatus;

  rideId: string;
  originCity: string;
  destinationCity: string;
  departureTime: string; // ISO
  rideStatus: string;

  driverName: string | null;
  driverPublicId: string | null;
  conversationId: string | null;

  isRideOnly: boolean;

  distanceMiles?: number | null;
  passengerCount?: number | null;
  tripStartedAt?: string | null;
  tripCompletedAt?: string | null;

  paymentType?: PaymentType | null;
  cashDiscountBps?: number | null;

  baseTotalPriceCents?: number | null;
  effectiveTotalPriceCents?: number | null;
};

type ApiResponse = { ok: true; bookings: Booking[] } | { ok: false; error: string };

function safeDate(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

function getEffectiveFareCents(b: Booking): number | null {
  if (typeof b.effectiveTotalPriceCents === "number") return b.effectiveTotalPriceCents;
  if (typeof b.baseTotalPriceCents === "number") return b.baseTotalPriceCents;
  return null;
}

export default function RiderBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/rider/bookings", { method: "GET" });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          if (!cancelled) setError(`Failed to load bookings. Status ${res.status}: ${text || "Unknown error"}`);
          return;
        }

        const data: ApiResponse = await res.json();

        if (!data.ok) {
          if (!cancelled) setError(data.error || "Failed to load bookings");
          return;
        }

        if (!cancelled) setBookings(data.bookings || []);
      } catch (err) {
        console.error("Error fetching rider bookings:", err);
        if (!cancelled) setError("Unexpected error while loading bookings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const { upcoming, completed } = useMemo(() => {
    const upcomingList = bookings.filter((b) => b.status !== "COMPLETED" && b.status !== "CANCELLED");
    const completedList = bookings.filter((b) => b.status === "COMPLETED");

    // Upcoming: soonest first, Completed: newest first
    upcomingList.sort((a, b) => (safeDate(a.departureTime)?.getTime() ?? 0) - (safeDate(b.departureTime)?.getTime() ?? 0));
    completedList.sort((a, b) => (safeDate(b.tripCompletedAt || b.departureTime)?.getTime() ?? 0) - (safeDate(a.tripCompletedAt || a.departureTime)?.getTime() ?? 0));

    return { upcoming: upcomingList, completed: completedList };
  }, [bookings]);

  return (
    <main
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "24px 16px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 650, marginBottom: 4 }}>Rider bookings</h1>
          <p style={{ color: "#555", margin: 0 }}>Upcoming rides, completed rides, receipts, and chat.</p>
        </div>

        <Link href="/rider/portal">
          <button
            type="button"
            style={{
              padding: "10px 14px",
              borderRadius: 999,
              border: "1px solid #d1d5db",
              background: "#fff",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Back to portal
          </button>
        </Link>
      </header>

      {loading && <p>Loading your bookings...</p>}

      {!loading && error && <p style={{ color: "red", marginBottom: 16 }}>{error}</p>}

      {!loading && !error && (
        <>
          <section style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 20, fontWeight: 650, marginBottom: 8 }}>Upcoming rides</h2>

            {upcoming.length === 0 ? (
              <p style={{ color: "#555" }}>You have no upcoming rides.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {upcoming.map((b) => {
                  const dt = safeDate(b.departureTime);
                  const eff = getEffectiveFareCents(b);

                  return (
                    <li
                      key={b.id}
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 10,
                        padding: 12,
                        marginBottom: 10,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {b.originCity} → {b.destinationCity}
                        </div>

                        <div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>
                          Departure: {dt ? dt.toLocaleString() : b.departureTime}
                          {typeof eff === "number" ? ` • $${formatMoney(eff)}` : ""}
                        </div>

                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                          Booking: {b.status} • Ride: {b.rideStatus}
                          {b.isRideOnly ? " (request pending)" : ""}
                        </div>

                        {b.driverName ? <div style={{ fontSize: 12, color: "#6b7280" }}>Driver: {b.driverName}</div> : null}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, minWidth: 170 }}>
                        <Link href={`/rider/trips/${encodeURIComponent(b.rideId)}`}>
                          <button
                            type="button"
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "1px solid #d1d5db",
                              cursor: "pointer",
                              fontSize: 14,
                              background: "#fff",
                            }}
                          >
                            Trip details
                          </button>
                        </Link>

                        {b.conversationId ? (
                          <Link href={`/chat/${b.conversationId}`}>
                            <button
                              type="button"
                              style={{
                                width: "100%",
                                padding: "8px 12px",
                                borderRadius: 8,
                                border: "1px solid #d1d5db",
                                cursor: "pointer",
                                fontSize: 14,
                                background: "#fff",
                              }}
                            >
                              Open chat
                            </button>
                          </Link>
                        ) : (
                          <button
                            type="button"
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "1px solid #eee",
                              fontSize: 14,
                              color: "#777",
                              background: "#f9f9f9",
                              cursor: "not-allowed",
                            }}
                            disabled
                          >
                            Chat not started
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h2 style={{ fontSize: 20, fontWeight: 650, marginBottom: 8 }}>Completed rides</h2>

            {completed.length === 0 ? (
              <p style={{ color: "#555" }}>You have no completed rides yet.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {completed.map((b) => {
                  const dt = safeDate(b.departureTime);
                  const eff = getEffectiveFareCents(b);

                  // IMPORTANT:
                  // Receipt route is /receipt/<bookingId> (not rideId)
                  const receiptHref = b.bookingId ? `/receipt/${encodeURIComponent(b.bookingId)}?autoprint=1` : null;

                  return (
                    <li
                      key={b.id}
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 10,
                        padding: 12,
                        marginBottom: 10,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {b.originCity} → {b.destinationCity}
                        </div>

                        <div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>
                          Departure: {dt ? dt.toLocaleString() : b.departureTime}
                          {typeof eff === "number" ? ` • $${formatMoney(eff)}` : ""}
                        </div>

                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                          Booking: {b.status} • Ride: {b.rideStatus}
                        </div>

                        {b.driverName ? <div style={{ fontSize: 12, color: "#6b7280" }}>Driver: {b.driverName}</div> : null}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, minWidth: 170 }}>
                        <Link href={`/rider/trips/${encodeURIComponent(b.rideId)}`}>
                          <button
                            type="button"
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "1px solid #d1d5db",
                              cursor: "pointer",
                              fontSize: 14,
                              background: "#fff",
                            }}
                          >
                            Trip details
                          </button>
                        </Link>

                        {receiptHref ? (
                          <Link href={receiptHref} target="_blank" rel="noopener noreferrer">
                            <button
                              type="button"
                              style={{
                                width: "100%",
                                padding: "8px 12px",
                                borderRadius: 8,
                                border: "1px solid #d1d5db",
                                cursor: "pointer",
                                fontSize: 14,
                                background: "#fff",
                              }}
                            >
                              Receipt
                            </button>
                          </Link>
                        ) : (
                          <button
                            type="button"
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "1px solid #eee",
                              fontSize: 14,
                              color: "#777",
                              background: "#f9f9f9",
                              cursor: "not-allowed",
                            }}
                            disabled
                            title="No booking record exists for this completed ride."
                          >
                            Receipt unavailable
                          </button>
                        )}

                        {b.conversationId ? (
                          <Link href={`/chat/${b.conversationId}`}>
                            <button
                              type="button"
                              style={{
                                width: "100%",
                                padding: "8px 12px",
                                borderRadius: 8,
                                border: "1px solid #d1d5db",
                                cursor: "pointer",
                                fontSize: 14,
                                background: "#fff",
                              }}
                            >
                              Open chat
                            </button>
                          </Link>
                        ) : (
                          <button
                            type="button"
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "1px solid #eee",
                              fontSize: 14,
                              color: "#777",
                              background: "#f9f9f9",
                              cursor: "not-allowed",
                            }}
                            disabled
                          >
                            Chat not started
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}