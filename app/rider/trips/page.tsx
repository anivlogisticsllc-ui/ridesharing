"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

type RiderTrip = {
  rideId: string;
  bookingId: string | null;

  status: BookingStatus;
  rideStatus: string;

  originCity: string;
  destinationCity: string;
  originAddress?: string | null;
  destinationAddress?: string | null;

  departureTime: string; // ISO
  tripStartedAt?: string | null;
  tripCompletedAt?: string | null;

  distanceMiles?: number | null;
  totalPriceCents?: number | null;
  passengerCount?: number | null;

  driverName?: string | null;
  driverPublicId?: string | null;
  conversationId?: string | null;
};

type TripResponse =
  | { ok: true; trip: RiderTrip }
  | { ok: false; error: string; code?: string };

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

function formatMiles(m?: number | null) {
  if (m == null) return null;
  return m.toFixed(2);
}

function formatMoney(cents?: number | null) {
  if (cents == null) return null;
  return (cents / 100).toFixed(2);
}

function statusLabel(b: RiderTrip) {
  // You can tweak this mapping to your liking
  if (b.status === "CANCELLED") return "Cancelled";
  if (b.status === "EXPIRED") return "Expired";
  if (b.rideStatus === "IN_ROUTE") return "In route";
  if (b.status === "COMPLETED") return "Completed";
  if (b.status === "CONFIRMED") return "Confirmed";
  return "Pending";
}

export default function RiderTripPage({
  params,
}: {
  params: { rideId: string };
}) {
  const router = useRouter();
  const { rideId } = params;

  const [trip, setTrip] = useState<RiderTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        // Adjust path if your API differs, e.g. /api/rider/trips?rideId=...
        const res = await fetch(`/api/rider/trips/${encodeURIComponent(rideId)}`);

        if (!res.ok) {
          const text = await res.text();
          if (cancelled) return;

          if (res.status === 404) {
            setError("Trip not found.");
          } else if (res.status === 403) {
            setError("You don’t have access to this trip.");
          } else {
            setError(
              `Failed to load trip. Status ${res.status}: ${text || "Unknown error"}`
            );
          }
          return;
        }

        const data: TripResponse = await res.json();
        if (cancelled) return;

        if (!data.ok) {
          setError(data.error || "Failed to load trip.");
          return;
        }

        setTrip(data.trip);
      } catch (err) {
        console.error("Error loading rider trip:", err);
        if (!cancelled) {
          setError("Unexpected error while loading trip.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [rideId]);

  const handleBack = () => {
    // Try browser back first, fall back to portal
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/rider/portal");
    }
  };

  const departure = formatDateTime(trip?.departureTime);
  const started = formatDateTime(trip?.tripStartedAt ?? null);
  const completed = formatDateTime(trip?.tripCompletedAt ?? null);
  const miles = formatMiles(trip?.distanceMiles ?? null);
  const total = formatMoney(trip?.totalPriceCents ?? null);

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "24px 16px 40px",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Top bar */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <button
          type="button"
          onClick={handleBack}
          style={{
            padding: "6px 10px",
            borderRadius: 999,
            border: "1px solid #d1d5db",
            background: "#ffffff",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          ← Back to portal
        </button>

        {trip?.conversationId && (
          <a href={`/chat/${trip.conversationId}`} target="_blank">
            <button
              type="button"
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: "1px solid #d1d5db",
                background: "#111827",
                color: "#ffffff",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Open chat with driver
            </button>
          </a>
        )}
      </header>

      {loading && <p>Loading trip details…</p>}

      {!loading && error && (
        <p style={{ color: "red", fontSize: 14 }}>{error}</p>
      )}

      {!loading && !error && trip && (
        <>
          {/* Hero card */}
          <section
            style={{
              borderRadius: 16,
              border: "1px solid #e5e7eb",
              padding: 18,
              marginBottom: 20,
              background: "#f9fafb",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "flex-start",
              }}
            >
              <div>
                <div
                  style={{
                    display: "inline-block",
                    padding: "3px 10px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    background:
                      trip.rideStatus === "IN_ROUTE"
                        ? "#dcfce7"
                        : trip.status === "COMPLETED"
                        ? "#e0f2fe"
                        : trip.status === "CANCELLED" ||
                          trip.status === "EXPIRED"
                        ? "#fee2e2"
                        : "#f3f4f6",
                    color:
                      trip.rideStatus === "IN_ROUTE"
                        ? "#166534"
                        : trip.status === "COMPLETED"
                        ? "#1d4ed8"
                        : trip.status === "CANCELLED" ||
                          trip.status === "EXPIRED"
                        ? "#b91c1c"
                        : "#374151",
                    marginBottom: 6,
                  }}
                >
                  {statusLabel(trip)}
                </div>
                <h1
                  style={{
                    margin: 0,
                    fontSize: 24,
                    fontWeight: 650,
                    marginBottom: 4,
                  }}
                >
                  {trip.originCity} → {trip.destinationCity}
                </h1>
                {trip.originAddress && trip.destinationAddress && (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      color: "#4b5563",
                    }}
                  >
                    {trip.originAddress} → {trip.destinationAddress}
                  </p>
                )}
                {departure && (
                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: 13,
                      color: "#4b5563",
                    }}
                  >
                    Scheduled departure: {departure}
                  </p>
                )}
              </div>

              <div
                style={{
                  minWidth: 180,
                  textAlign: "right",
                  fontSize: 13,
                }}
              >
                {miles && (
                  <p style={{ margin: 0 }}>
                    <span style={{ color: "#6b7280" }}>Distance:</span>{" "}
                    <strong>{miles} mi</strong>
                  </p>
                )}
                {total && (
                  <p style={{ margin: "4px 0 0" }}>
                    <span style={{ color: "#6b7280" }}>Total:</span>{" "}
                    <strong>${total}</strong>
                  </p>
                )}
                {trip.passengerCount != null && (
                  <p style={{ margin: "4px 0 0" }}>
                    <span style={{ color: "#6b7280" }}>Passengers:</span>{" "}
                    <strong>{trip.passengerCount}</strong>
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Timeline / details */}
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.4fr)",
              gap: 16,
              alignItems: "flex-start",
            }}
          >
            {/* Left column: timeline and IDs */}
            <div
              style={{
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                padding: 14,
                background: "#ffffff",
              }}
            >
              <h2
                style={{
                  margin: "0 0 8px",
                  fontSize: 16,
                  fontWeight: 600,
                }}
              >
                Trip timeline
              </h2>

              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  fontSize: 13,
                  color: "#4b5563",
                }}
              >
                <li style={{ marginBottom: 6 }}>
                  <strong>Ride ID:</strong> {trip.rideId}
                </li>
                <li style={{ marginBottom: 6 }}>
                  <strong>Booking ID:</strong>{" "}
                  {trip.bookingId ?? "Not booked / ride only"}
                </li>
                <li style={{ marginBottom: 6 }}>
                  <strong>Status:</strong> {trip.status} /{" "}
                  {trip.rideStatus}
                </li>
                {started && (
                  <li style={{ marginBottom: 6 }}>
                    <strong>Trip started:</strong> {started}
                  </li>
                )}
                {completed && (
                  <li style={{ marginBottom: 6 }}>
                    <strong>Trip completed:</strong> {completed}
                  </li>
                )}
              </ul>
            </div>

            {/* Right column: driver + receipt actions */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div
                style={{
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  padding: 14,
                  background: "#ffffff",
                }}
              >
                <h2
                  style={{
                    margin: "0 0 8px",
                    fontSize: 16,
                    fontWeight: 600,
                  }}
                >
                  Driver
                </h2>
                {trip.driverName ? (
                  <>
                    <p
                      style={{
                        margin: "0 0 4px",
                        fontSize: 13,
                      }}
                    >
                      <strong>{trip.driverName}</strong>
                    </p>
                    {trip.driverPublicId && (
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          color: "#6b7280",
                        }}
                      >
                        Driver ID: {trip.driverPublicId}
                      </p>
                    )}
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: 13 }}>
                    Driver is not assigned yet.
                  </p>
                )}
              </div>

              <div
                style={{
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  padding: 14,
                  background: "#ffffff",
                }}
              >
                <h2
                  style={{
                    margin: "0 0 8px",
                    fontSize: 16,
                    fontWeight: 600,
                  }}
                >
                  Receipt
                </h2>
                {miles || total ? (
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: 0,
                      fontSize: 13,
                      color: "#4b5563",
                    }}
                  >
                    {miles && (
                      <li style={{ marginBottom: 4 }}>
                        <strong>Distance:</strong> {miles} mi
                      </li>
                    )}
                    {total && (
                      <li style={{ marginBottom: 4 }}>
                        <strong>Total fare:</strong> ${total}
                      </li>
                    )}
                    {trip.passengerCount != null && (
                      <li style={{ marginBottom: 4 }}>
                        <strong>Passengers:</strong>{" "}
                        {trip.passengerCount}
                      </li>
                    )}
                  </ul>
                ) : (
                  <p style={{ margin: 0, fontSize: 13 }}>
                    Fare details will be available once the trip is
                    completed.
                  </p>
                )}

                {trip.status === "COMPLETED" && trip.bookingId && (
                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        window.open(`/driver/rides/${trip.rideId}`, "_blank")
                      }
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
                    {/* You already have resend-receipt API from portal;
                        if you want, you can add another button here that calls it. */}
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
