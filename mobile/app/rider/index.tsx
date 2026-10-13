// mobile/app/rider/index.tsx

import { Link } from "expo-router";
import { ScrollView, Text, View } from "react-native";

export default function RiderHomeScreen() {
  return (
    <ScrollView
      contentContainerStyle={{
        padding: 24,
        backgroundColor: "#f9fafb",
      }}
    >
      <View
        style={{
          borderRadius: 24,
          padding: 22,
          backgroundColor: "#111827",
          marginBottom: 18,
        }}
      >
        <Text
          style={{
            color: "#ffffff",
            fontSize: 30,
            fontWeight: "700",
          }}
        >
          HDriven
        </Text>

        <Text
          style={{
            color: "#d1d5db",
            marginTop: 8,
            fontSize: 15,
          }}
        >
          Request rides, track active trips, and review your ride history.
        </Text>
      </View>

      <View
        style={{
          borderWidth: 1,
          borderColor: "#e5e7eb",
          borderRadius: 18,
          padding: 18,
          backgroundColor: "#ffffff",
        }}
      >
        <Text
          style={{
            fontSize: 22,
            fontWeight: "600",
            marginBottom: 8,
          }}
        >
          Rider Home
        </Text>

        <Text
          style={{
            color: "#6b7280",
            marginBottom: 18,
          }}
        >
          Start a new ride request or review your existing rides.
        </Text>

        <Link
          href="/rider/request"
          style={{
            backgroundColor: "#111827",
            color: "#ffffff",
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 12,
            fontWeight: "600",
            textAlign: "center",
            overflow: "hidden",
          }}
        >
          Request a ride
        </Link>

        <Link
          href="/rider/bookings"
          style={{
            marginTop: 10,
            backgroundColor: "#ffffff",
            color: "#111827",
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#d1d5db",
            fontWeight: "600",
            textAlign: "center",
            overflow: "hidden",
          }}
        >
          View rides
        </Link>
      </View>
    </ScrollView>
  );
}