import { Link } from "expo-router";
import { Text, View } from "react-native";

export default function HomeScreen() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 28, fontWeight: "700" }}>HDriven</Text>
      <Text style={{ marginTop: 8, fontSize: 16 }}>Mobile app foundation is working.</Text>

      <Link href="/login" style={{ marginTop: 24, fontSize: 16 }}>
        Go to Login
      </Link>
    </View>
  );
}