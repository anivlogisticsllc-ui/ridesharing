"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";

type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  sender: {
    id: string;
    name: string | null;
    publicId: string | null;
  };
};

export default function ChatPage() {
  const router = useRouter();
  const params = useParams<{ conversationId: string }>();
  const conversationId = params?.conversationId;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Poll every 5 seconds
  useEffect(() => {
    if (!conversationId) return;

    let cancelled = false;
    let interval: NodeJS.Timeout;

    async function loadMessages() {
      try {
        const res = await fetch(`/api/chat/${conversationId}`);
        const data = await res.json().catch(() => null);

        if (!res.ok || !data?.ok) {
          if (!cancelled) setError(data?.error || "Could not load chat.");
          return;
        }

        if (!cancelled) {
          setMessages(data.messages);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError("Network error while loading chat.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMessages();
    interval = setInterval(loadMessages, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [conversationId]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    const text = input.trim();
    setInput("");

    try {
      const res = await fetch(`/api/chat/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Could not send message.");
        return;
      }

      setMessages((prev) => [...prev, data.message]);
    } catch {
      setError("Network error while sending message.");
    }
  }

  return (
    <main
      style={{
        padding: "24px 16px",
        maxWidth: 800,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Chat header */}
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
        Ride chat
      </h1>

      {/* Messages section */}
      <div style={{ marginBottom: 24 }}>
        {loading ? (
          <p style={{ color: "#6b7280" }}>Loading chat…</p>
        ) : error ? (
          <p style={{ color: "#b91c1c" }}>{error}</p>
        ) : messages.length === 0 ? (
          <p style={{ color: "#6b7280" }}>No messages yet. Say hi!</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {messages.map((m) => (
              <li
                key={m.id}
                style={{
                  padding: 10,
                  marginBottom: 12,
                  background: "#f3f4f6",
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: "#374151",
                    marginBottom: 4,
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{m.sender.publicId || m.sender.name || "User"}</span>
                  <span style={{ color: "#9ca3af" }}>
                    {new Date(m.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <div style={{ fontSize: 14 }}>{m.body}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Input box */}
      <form
        onSubmit={handleSend}
        style={{
          display: "flex",
          gap: 8,
          borderTop: "1px solid #e5e7eb",
          paddingTop: 16,
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 6,
            border: "1px solid #d1d5db",
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          style={{
            padding: "10px 16px",
            background: "#111827",
            color: "#fff",
            borderRadius: 6,
            fontSize: 14,
            opacity: input.trim() ? 1 : 0.5,
            cursor: input.trim() ? "pointer" : "default",
          }}
        >
          Send
        </button>
      </form>
    </main>
  );
}
