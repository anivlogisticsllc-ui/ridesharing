// mobile/app/rider/chat/[conversationId].tsx

import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { apiRequest } from "../../../services/api";
import { getAuthToken } from "../../../services/auth";

type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  senderId: string;
  sender: {
    id: string;
    name: string | null;
    publicId: string | null;
  };
};

type ChatGetResponse =
  | { ok: true; rideStatus: string | null; messages: ChatMessage[] }
  | { ok: false; error: string };

type ChatPostResponse =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: string };

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function RiderChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    conversationId?: string;
    rideId?: string;
  }>();

  const conversationId =
    typeof params.conversationId === "string" ? params.conversationId : "";

  const rideId =
    typeof params.rideId === "string" ? params.rideId : "";

  function returnToTrip() {
    if (rideId) {
      router.replace(
        `/rider/trip/${encodeURIComponent(rideId)}`
      );
    } else {
      router.replace("/rider/bookings");
    }
  }

  const scrollRef = useRef<ScrollView | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [rideStatus, setRideStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readOnly =
    rideStatus === "COMPLETED" || rideStatus === "CANCELLED";

  async function loadMessages(options?: { silent?: boolean }) {
    if (!conversationId) return;

    try {
      if (!options?.silent) setLoading(true);

      const token = await getAuthToken();

      const data = await apiRequest<ChatGetResponse>(
        `/api/mobile/chat/${encodeURIComponent(conversationId)}`,
        { token }
      );

      if (!data.ok) {
        setError(data.error || "Failed to load chat.");
        return;
      }

      setMessages(data.messages);
      setRideStatus(data.rideStatus);
      setError(null);

      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: false });
      }, 0);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load chat."
      );
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }

  async function sendMessage() {
    const body = draft.trim();
    if (!body || sending || readOnly) return;

    try {
      setSending(true);
      setError(null);

      const token = await getAuthToken();

      const data = await apiRequest<ChatPostResponse>(
        `/api/mobile/chat/${encodeURIComponent(conversationId)}`,
        {
          method: "POST",
          token,
          body: { body },
        }
      );

      if (!data.ok) {
        setError(data.error || "Failed to send message.");
        return;
      }

      setDraft("");
      setDraft("");
      setMessages((current) => [...current, data.message]);

      setTimeout(() => {
        returnToTrip();
      }, 250);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send message."
      );
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    void loadMessages();

    const id = setInterval(() => {
      void loadMessages({ silent: true });
    }, 3000);

    return () => clearInterval(id);
  }, [conversationId]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, color: "#6b7280" }}>Loading chat...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#f9fafb" }}>
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: "#e5e7eb",
          backgroundColor: "#ffffff",
        }}
      >
        <Pressable onPress={returnToTrip}>

          <Text style={{ color: "#2563eb", fontWeight: "600" }}>← Back</Text>
        </Pressable>

        <Text style={{ marginTop: 10, fontSize: 22, fontWeight: "600" }}>
          Driver chat
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, gap: 10 }}
        onContentSizeChange={() =>
          scrollRef.current?.scrollToEnd({ animated: false })
        }
      >
        {messages.length === 0 ? (
          <Text
            style={{
              color: "#6b7280",
              textAlign: "center",
              marginTop: 20,
            }}
          >
            No messages yet.
          </Text>
        ) : (
          messages.map((message) => (
            <View
              key={message.id}
              style={{
                borderWidth: 1,
                borderColor: "#e5e7eb",
                backgroundColor: "#ffffff",
                borderRadius: 14,
                padding: 11,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <Text style={{ fontWeight: "600", color: "#374151" }}>
                  {message.sender.name || message.sender.publicId || "User"}
                </Text>

                <Text style={{ color: "#9ca3af", fontSize: 12 }}>
                  {formatTime(message.createdAt)}
                </Text>
              </View>

              <Text
                style={{
                  marginTop: 5,
                  color: "#111827",
                  lineHeight: 20,
                }}
              >
                {message.body}
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      {error ? (
        <Text
          style={{
            color: "#b91c1c",
            paddingHorizontal: 14,
            paddingBottom: 8,
          }}
        >
          {error}
        </Text>
      ) : null}

      {readOnly ? (
        <View
          style={{
            padding: 14,
            borderTopWidth: 1,
            borderTopColor: "#e5e7eb",
            backgroundColor: "#ffffff",
          }}
        >
          <Text style={{ color: "#6b7280" }}>
            This chat is read-only because the trip is completed or cancelled.
          </Text>
        </View>
      ) : (
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            padding: 12,
            borderTopWidth: 1,
            borderTopColor: "#e5e7eb",
            backgroundColor: "#ffffff",
          }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message your driver"
            multiline
            style={{
              flex: 1,
              minHeight: 42,
              maxHeight: 100,
              borderWidth: 1,
              borderColor: "#d1d5db",
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 9,
              backgroundColor: "#ffffff",
            }}
          />

          <Pressable
            onPress={() => void sendMessage()}
            disabled={!draft.trim() || sending}
            style={{
              alignSelf: "flex-end",
              minHeight: 42,
              justifyContent: "center",
              paddingHorizontal: 15,
              borderRadius: 12,
              backgroundColor:
                !draft.trim() || sending ? "#9ca3af" : "#111827",
            }}
          >
            <Text style={{ color: "#ffffff", fontWeight: "600" }}>
              {sending ? "..." : "Send"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}