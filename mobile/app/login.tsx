// mobile/app/login.tsx

import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { apiRequest } from "../services/api";
import { saveAuth, type LoginResult } from "../services/auth";

type LoginResponse =
  | {
      ok: true;
      token: string;
      user: LoginResult["user"];
    }
  | {
      ok: false;
      error: string;
    };

export default function LoginScreen() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    try {
      setBusy(true);
      setError(null);

      const data = await apiRequest<LoginResponse>("/api/mobile/auth/login", {
        method: "POST",
        body: {
          email,
          password,
        },
      });

      if (!data.ok) {
        setError(data.error || "Login failed.");
        return;
      }

      await saveAuth({
        token: data.token,
        user: data.user,
      });

      router.replace("/rider");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 30, fontWeight: "800", marginBottom: 8 }}>
        HDriven
      </Text>

      <Text style={{ fontSize: 22, fontWeight: "700", marginBottom: 24 }}>
        Login
      </Text>

      {error ? (
        <Text style={{ color: "#b91c1c", marginBottom: 12 }}>{error}</Text>
      ) : null}

      <TextInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{
          borderWidth: 1,
          borderColor: "#ddd",
          borderRadius: 12,
          padding: 12,
          marginBottom: 12,
        }}
      />

      <TextInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{
          borderWidth: 1,
          borderColor: "#ddd",
          borderRadius: 12,
          padding: 12,
          marginBottom: 20,
        }}
      />

      <Pressable
        onPress={handleLogin}
        disabled={busy}
        style={{
          backgroundColor: busy ? "#9ca3af" : "#111827",
          padding: 14,
          borderRadius: 12,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#ffffff", fontWeight: "700" }}>
          {busy ? "Signing in..." : "Sign in"}
        </Text>
      </Pressable>
    </View>
  );
}