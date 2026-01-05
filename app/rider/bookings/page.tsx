"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

type Booking = {
  id: string;
  status: BookingStatus;
  rideId: string;
  originCity: string;
  destinationCity: string;
  departureTime: string; // ISO string
  rideStatus: string;
  driverName: string | null;
  driverPublicId: string | null;
  conversationId: string | null;
};

type ApiResponse =
  | { ok: true; bookings: Booking[] }
  | { ok: false; error: string };

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
          if (!cancelled) {
            setError(
              `Failed to load bookings. Status ${res.status}: ${text || "Unknown error"}`
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

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const upcoming = bookings.filter(
    (b) => b.status !== "COMPLETED" && b.status !== "CANCELLED"
  );
  const completed = bookings.filter((b) => b.status === "COMPLETED");

  return (
    <main
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "24px 16px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 4 }}>
            Rider portal
          </h1>
          <p style={{ color: "#555", margin: 0 }}>
            View your upcoming and completed rides, and chat with drivers.
          </p>
        </div>
      </header>

      {loading && <p>Loading your bookings...</p>}

      {!loading && error && (
        <p style={{ color: "red", marginBottom: 16 }}>{error}</p>
      )}

      {!loading && !error && (
        <>
          {/* Upcoming rides */}
          <section style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
              Upcoming rides
            </h2>

            {upcoming.length === 0 ? (
              <p style={{ color: "#555" }}>You have no upcoming rides.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {upcoming.map((b) => {
                  const dt = new Date(b.departureTime);

                  return (
                    <li
                      key={b.id}
                      style={{
                        border: "1px solid #ddd",
                        borderRadius: 8,
                        padding: 12,
                        marginBottom: 8,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          {b.originCity} → {b.destinationCity}
                        </div>
                        <div style={{ fontSize: 14, color: "#555" }}>
                          Departure: {dt.toLocaleString()}
                        </div>
                        <div style={{ fontSize: 14, color: "#555" }}>
                          Booking status: {b.status}
                          {" • "}Ride status: {b.rideStatus}
                        </div>
                        {b.driverName && (
                          <div style={{ fontSize: 14, color: "#555" }}>
                            Driver: {b.driverName}
                          </div>
                        )}
                      </div>

                      {/* Chat actions */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "center",
                          gap: 8,
                          minWidth: 160,
                        }}
                      >
                        {b.conversationId ? (
                          <Link href={`/chat/${b.conversationId}`}>
                            <button
                              type="button"
                              style={{
                                width: "100%",
                                padding: "8px 12px",
                                borderRadius: 6,
                                border: "1px solid #ccc",
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
                              borderRadius: 6,
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

          {/* Completed rides */}
          <section>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
              Completed rides
            </h2>

            {completed.length === 0 ? (
              <p style={{ color: "#555" }}>You have no completed rides yet.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {completed.map((b) => {
                  const dt = new Date(b.departureTime);
                  const receiptHref = `/receipt/${encodeURIComponent(
                    b.id
                  )}?autoprint=1`;

                  return (
                    <li
                      key={b.id}
                      style={{
                        border: "1px solid #ddd",
                        borderRadius: 8,
                        padding: 12,
                        marginBottom: 8,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          {b.originCity} → {b.destinationCity}
                        </div>
                        <div style={{ fontSize: 14, color: "#555" }}>
                          Departure: {dt.toLocaleString()}
                        </div>
                        <div style={{ fontSize: 14, color: "#555" }}>
                          Booking status: {b.status}
                          {" • "}Ride status: {b.rideStatus}
                        </div>
                        {b.driverName && (
                          <div style={{ fontSize: 14, color: "#555" }}>
                            Driver: {b.driverName}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "center",
                          gap: 8,
                          minWidth: 160,
                        }}
                      >
                        {/* Receipt */}
                        <Link
                          href={receiptHref}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <button
                            type="button"
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: 6,
                              border: "1px solid #ccc",
                              cursor: "pointer",
                              fontSize: 14,
                              background: "#fff",
                            }}
                          >
                            Receipt
                          </button>
                        </Link>

                        {/* Chat */}
                        {b.conversationId ? (
                          <Link href={`/chat/${b.conversationId}`}>
                            <button
                              type="button"
                              style={{
                                width: "100%",
                                padding: "8px 12px",
                                borderRadius: 6,
                                border: "1px solid #ccc",
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
                              borderRadius: 6,
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
