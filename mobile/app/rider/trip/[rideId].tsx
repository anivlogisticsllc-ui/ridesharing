import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { apiRequest } from "../../../services/api";
import { getAuthToken } from "../../../services/auth";
import type { RiderBooking, RiderBookingsResponse } from "../../../types/rider";

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function formatMoney(cents?: number | null) {
  if (typeof cents !== "number") return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export default function RiderTripDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ rideId?: string }>();
  const rideId = typeof params.rideId === "string" ? params.rideId : "";

  const [booking, setBooking] = useState<RiderBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadTrip() {
    try {
      setLoading(true);
      setError(null);

      const token = await getAuthToken();

      const data = await apiRequest<RiderBookingsResponse>(
        "/api/mobile/rider/bookings",
        { token }
      );

      if (!data.ok) {
        setError(data.error || "Failed to load trip.");
        return;
      }

      const found = data.bookings.find((b) => b.rideId === rideId);

      if (!found) {
        setError("Trip not found.");
        return;
      }

      setBooking(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trip.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTrip();
  }, [rideId]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 12 }}>Loading trip...</Text>
      </View>
    );
  }

  if (error || !booking) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
        <Text style={{ fontSize: 24, fontWeight: "800", marginBottom: 12 }}>
          Trip Details
        </Text>
        <Text style={{ color: "#b91c1c", marginBottom: 16 }}>
          {error || "Trip not found."}
        </Text>

        <Pressable onPress={() => router.back()}>
          <Text style={{ color: "#2563eb", fontWeight: "700" }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const fare =
    booking.effectiveTotalPriceCents ??
    booking.totalPriceCents ??
    booking.baseTotalPriceCents ??
    null;

  return (
    <ScrollView contentContainerStyle={{ padding: 24 }}>
      <Pressable onPress={() => router.back()} style={{ marginBottom: 18 }}>
        <Text style={{ color: "#2563eb", fontWeight: "700" }}>← Back</Text>
      </Pressable>

      <Text style={{ fontSize: 28, fontWeight: "800", marginBottom: 8 }}>
        Trip Details
      </Text>

      <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 18 }}>
        {booking.originCity} → {booking.destinationCity}
      </Text>

      <View style={{ gap: 12 }}>
        <DetailRow label="Booking status" value={booking.status} />
        <DetailRow label="Ride status" value={booking.rideStatus} />
        <DetailRow label="Scheduled" value={formatDate(booking.departureTime)} />
        <DetailRow label="Started" value={formatDate(booking.tripStartedAt)} />
        <DetailRow label="Completed" value={formatDate(booking.tripCompletedAt)} />
        <DetailRow label="Driver" value={booking.driverName || "Not assigned"} />
        <DetailRow label="Fare" value={formatMoney(fare)} />
        <DetailRow
          label="Payment"
          value={booking.paymentType ? booking.paymentType : "Not available"}
        />
        <DetailRow
          label="Distance"
          value={
            typeof booking.distanceMiles === "number"
              ? `${booking.distanceMiles.toFixed(2)} miles`
              : "—"
          }
        />
        <DetailRow
          label="Passengers"
          value={
            typeof booking.passengerCount === "number"
              ? String(booking.passengerCount)
              : "—"
          }
        />
      </View>
    </ScrollView>
  );
}

function DetailRow(props: { label: string; value: string }) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: "#e5e7eb",
        borderRadius: 14,
        padding: 14,
        backgroundColor: "#ffffff",
      }}
    >
      <Text style={{ color: "#6b7280", fontSize: 13 }}>{props.label}</Text>
      <Text style={{ marginTop: 4, fontSize: 16, fontWeight: "700" }}>
        {props.value}
      </Text>
    </View>
  );
}