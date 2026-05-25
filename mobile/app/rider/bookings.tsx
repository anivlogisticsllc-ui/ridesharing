import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { apiRequest } from "../../services/api";
import type { RiderBooking, RiderBookingsResponse } from "../../types/rider";
import { getAuthToken } from "../../services/auth";

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleString();
}

function formatMoney(cents?: number | null) {
  if (typeof cents !== "number") return null;
  return `$${(cents / 100).toFixed(2)}`;
}

export default function RiderBookingsScreen() {
  const [bookings, setBookings] = useState<RiderBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadBookings() {
    try {
      setLoading(true);
      setError(null);

      const token = await getAuthToken();

      const data = await apiRequest<RiderBookingsResponse>(
        "/api/mobile/rider/bookings",
        { token }
      );

      if (!data.ok) {
        setError(data.error || "Failed to load bookings.");
        return;
      }

      setBookings(data.bookings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bookings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBookings();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 12 }}>Loading bookings...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
        <Text style={{ fontSize: 24, fontWeight: "700", marginBottom: 12 }}>
          Rider Bookings
        </Text>

        <Text style={{ color: "#b91c1c", marginBottom: 12 }}>
          {error}
        </Text>

        <Text style={{ color: "#6b7280" }}>
          If this says “Not authenticated”, that is expected for now. The web
          backend uses NextAuth cookies, and mobile needs bearer-token auth.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 24 }}>
      <Text style={{ fontSize: 28, fontWeight: "700", marginBottom: 16 }}>
        Rider Bookings
      </Text>

      {bookings.length === 0 ? (
        <Text style={{ color: "#6b7280" }}>No bookings found.</Text>
      ) : (
        bookings.map((booking) => {
          const fare =
            formatMoney(booking.effectiveTotalPriceCents) ||
            formatMoney(booking.totalPriceCents) ||
            formatMoney(booking.baseTotalPriceCents);

          return (
            <View
              key={`${booking.rideId}-${booking.bookingId ?? booking.id}`}
              style={{
                borderWidth: 1,
                borderColor: "#e5e7eb",
                borderRadius: 14,
                padding: 14,
                marginBottom: 12,
                backgroundColor: "#ffffff",
              }}
            >
              <Text style={{ fontSize: 17, fontWeight: "700" }}>
                {booking.originCity} → {booking.destinationCity}
              </Text>

              <Text style={{ marginTop: 6, color: "#4b5563" }}>
                {formatDate(booking.departureTime)}
              </Text>

              <Text style={{ marginTop: 4, color: "#4b5563" }}>
                Booking: {booking.status} · Ride: {booking.rideStatus}
              </Text>

              {booking.driverName ? (
                <Text style={{ marginTop: 4, color: "#4b5563" }}>
                  Driver: {booking.driverName}
                </Text>
              ) : null}

              {fare ? (
                <Text style={{ marginTop: 8, fontWeight: "700" }}>
                  Fare: {fare}
                </Text>
              ) : null}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}