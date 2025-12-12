"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";

type TripStatus = "OPEN" | "IN_ROUTE" | "COMPLETED" | "CANCELLED" | string;
type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

type Trip = {
  rideId: string;
  originAddress: string;
  destinationAddress: string;
  departureTime: string;

  bookingStatus: BookingStatus;
  rideStatus: TripStatus;

  distanceMiles?: number | null;
  totalPriceCents?: number | null;

  driverName?: string | null;
  driverPublicId?: string | null;

  // Timeline
  requestedAt?: string | null;
  tripStartedAt?: string | null;
  tripCompletedAt?: string | null;

  // Chat
  conversationId?: string | null;
};

type ApiResponse =
  | { ok: true; trip: Trip }
  | { ok: false; error: string };

export default function RiderTripDetailsPage() {
  const router = useRouter();

  // Read rideId from the URL using useParams (more reliable in client pages)
  const params = useParams<{ rideId?: string | string[] }>();
  const rideId =
    typeof params?.rideId === "string"
      ? params.rideId
      : Array.isArray(params?.rideId)
      ? params.rideId[0]
      : "";

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] =
    useState<string | null>(null);

  useEffect(() => {
    if (!rideId) {
      setError("Missing ride id in URL.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(
          `/api/rider/trips/${encodeURIComponent(rideId)}`
        );

        if (!res.ok) {
          const text = await res.text();
          if (!cancelled) {
            setError(`Failed to load trip. Status ${res.status}: ${text}`);
          }
          return;
        }

        const data: ApiResponse = await res.json();
        if (!("ok" in data) || !data.ok) {
          if (!cancelled) {
            setError(data?.error || "Failed to load trip.");
          }
          return;
        }

        if (!cancelled) {
          setTrip(data.trip);
        }
      } catch (err) {
        console.error("Error fetching trip:", err);
        if (!cancelled) {
          setError("Unexpected error while loading trip.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [rideId]);

  function formatDateTime(value?: string | null) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  }

  function formatMoney(cents?: number | null) {
    if (cents == null) return "—";
    return `$${(cents / 100).toFixed(2)}`;
  }

  const canChat =
    !!trip &&
    !!trip.conversationId &&
    trip.conversationId.trim().length > 0;

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
      {/* Back link */}
      <button
        type="button"
        onClick={() => router.push("/rider/portal")}
        style={{
          border: "none",
          background: "transparent",
          color: "#4b5563",
          fontSize: 14,
          cursor: "pointer",
          marginBottom: 12,
        }}
      >
        ← Back to rider portal
      </button>

      {/* Header */}
      <header style={{ marginBottom: 20 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 650,
            marginBottom: 4,
          }}
        >
          Trip details
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "#6b7280",
          }}
        >
          Ride ID:{" "}
          <span style={{ fontFamily: "monospace" }}>
            {rideId || "—"}
          </span>
        </p>
      </header>

      {loading && <p>Loading trip…</p>}

      {!loading && error && (
        <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>
      )}

      {!loading && !error && trip && (
        <>
          {/* Top card: route, statuses, distance/fare + chat */}
          <section
            style={{
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              padding: 16,
              background: "#ffffff",
              marginBottom: 16,
            }}
          >
            <div
              style={{
                marginBottom: 10,
                fontSize: 15,
                fontWeight: 600,
                color: "#111827",
              }}
            >
              {trip.originAddress} → {trip.destinationAddress}
            </div>

            <div
              style={{
                fontSize: 13,
                color: "#4b5563",
                marginBottom: 12,
              }}
            >
              Departure: {formatDateTime(trip.departureTime)}
            </div>

            {/* Status chips */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <Chip label="Booking" value={trip.bookingStatus} tone="green" />
              <Chip
                label="Ride"
                value={trip.rideStatus}
                tone={
                  trip.rideStatus === "IN_ROUTE"
                    ? "amber"
                    : trip.rideStatus === "COMPLETED"
                    ? "green"
                    : trip.rideStatus === "CANCELLED"
                    ? "red"
                    : "gray"
                }
              />
            </div>

            {/* Distance / fare */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 16,
                fontSize: 14,
                marginBottom: 12,
              }}
            >
              <div>
                <strong>Distance:</strong>{" "}
                {trip.distanceMiles != null
                  ? `${trip.distanceMiles.toFixed(2)} miles`
                  : "—"}
              </div>
              <div>
                <strong>Total fare:</strong>{" "}
                {formatMoney(trip.totalPriceCents)}
              </div>
            </div>

            {/* Driver info + chat button */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ fontSize: 14, color: "#4b5563" }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Driver information
                </div>
                <div>
                  Driver:{" "}
                  {trip.driverName ? trip.driverName : "Not assigned"}
                </div>
                {trip.driverPublicId && (
                  <div>Driver ID: {trip.driverPublicId}</div>
                )}
              </div>

              <div>
                <button
                  type="button"
                  onClick={() =>
                    canChat &&
                    setActiveConversationId(trip.conversationId as string)
                  }
                  disabled={!canChat}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: canChat
                      ? "1px solid #d1d5db"
                      : "1px solid #e5e7eb",
                    background: canChat ? "#ffffff" : "#f9fafb",
                    fontSize: 13,
                    color: canChat ? "#111827" : "#9ca3af",
                    cursor: canChat ? "pointer" : "not-allowed",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: "999px",
                      backgroundColor: canChat ? "#22c55e" : "#d1d5db",
                    }}
                  />
                  {canChat ? "View chat with driver" : "Chat not available"}
                </button>
              </div>
            </div>
          </section>

          {/* Timeline */}
          <section
            style={{
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              padding: 16,
              background: "#ffffff",
              marginBottom: 16,
            }}
          >
            <h2
              style={{
                margin: "0 0 8px",
                fontSize: 18,
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
                fontSize: 14,
                color: "#374151",
              }}
            >
              <TimelineItem
                label="Ride requested"
                time={trip.requestedAt || trip.departureTime}
                active
              />
              <TimelineItem
                label="Trip started"
                time={trip.tripStartedAt}
                active={!!trip.tripStartedAt}
              />
              <TimelineItem
                label="Trip completed"
                time={trip.tripCompletedAt}
                active={trip.rideStatus === "COMPLETED"}
              />
            </ul>
          </section>

            {/* Receipt note */}
          <section
            style={{
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              padding: 16,
              background: "#ffffff",
            }}
          >
            <h2
              style={{
                margin: "0 0 8px",
                fontSize: 18,
                fontWeight: 600,
              }}
            >
              Receipt
            </h2>
            <p
              style={{
                margin: "0 0 4px",
                fontSize: 14,
                color: "#4b5563",
              }}
            >
              You can find this trip inside your{" "}
              <a href="/rider/portal" style={{ color: "#4f46e5" }}>
                completed rides
              </a>{" "}
              and resend a receipt from there.
            </p>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
              In a future version, you can also show the full receipt directly
              on this page.
            </p>
          </section>
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

/* ---------- Small UI bits ---------- */

function Chip(props: {
  label: string;
  value: string;
  tone: "green" | "amber" | "red" | "gray";
}) {
  const { label, value, tone } = props;

  const palette: Record<
    typeof tone,
    { bg: string; border: string; text: string }
  > = {
    green: {
      bg: "#ecfdf5",
      border: "#bbf7d0",
      text: "#166534",
    },
    amber: {
      bg: "#fffbeb",
      border: "#fef3c7",
      text: "#92400e",
    },
    red: {
      bg: "#fef2f2",
      border: "#fecaca",
      text: "#b91c1c",
    },
    gray: {
      bg: "#f3f4f6",
      border: "#e5e7eb",
      text: "#374151",
    },
  };

  const colors = palette[tone];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        borderRadius: 999,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        fontSize: 12,
        color: colors.text,
      }}
    >
      <span style={{ fontWeight: 600 }}>{label}:</span>
      <span>{value}</span>
    </span>
  );
}

function TimelineItem(props: {
  label: string;
  time?: string | null;
  active?: boolean;
}) {
  const { label, time, active = false } = props;

  const formatted = time
    ? (() => {
        const d = new Date(time);
        if (Number.isNaN(d.getTime())) return time;
        return d.toLocaleString();
      })()
    : "—";

  return (
    <li
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        marginBottom: 6,
      }}
    >
      <span
        style={{
          marginTop: 4,
          width: 8,
          height: 8,
          borderRadius: "999px",
          backgroundColor: active ? "#22c55e" : "#d1d5db",
          flexShrink: 0,
        }}
      />
      <div>
        <div style={{ fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 13, color: "#6b7280" }}>{formatted}</div>
      </div>
    </li>
  );
}

/* ---------- Chat overlay ---------- */

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
