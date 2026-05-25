import { Link } from "expo-router";
import { Text, View } from "react-native";

export default function RiderHomeScreen() {
  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
      <Text style={{ fontSize: 28, fontWeight: "700" }}>Rider Home</Text>
      <Text style={{ marginTop: 8, fontSize: 16 }}>
        This will become the rider mobile portal.
      </Text>

      <Link href="/rider/bookings" style={{ marginTop: 24, fontSize: 16 }}>
        View bookings
      </Link>
    </View>
  );
}