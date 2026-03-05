"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

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

function safeConversationId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function markSeen(role: string | null, conversationId: string) {
  try {
    const who = role === "driver" ? "driver" : role === "rider" ? "rider" : "user";
    localStorage.setItem(`chat:lastSeen:${who}:${conversationId}`, new Date().toISOString());
  } catch {
    // ignore
  }
}

// Type guard TS always understands
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export default function ChatPage() {
  const params = useParams(); // let’s not pretend params is typed perfectly
  const searchParams = useSearchParams();

  const conversationId = useMemo(() => {
    const raw = (params as any)?.conversationId;
    return safeConversationId(raw);
  }, [params]);

  const sp = searchParams ?? new URLSearchParams();
  const isEmbedded = sp.get("embed") === "1";
  const role = sp.get("role"); // "driver" | "rider" | null
  const autoClose = sp.get("autoClose") === "1";
  const prefill = sp.get("prefill") ?? "";
  const isReadOnly = sp.get("readonly") === "1";

  const canSend = useMemo(() => !isReadOnly, [isReadOnly]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [hadFirstLoad, setHadFirstLoad] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isNonEmptyString(conversationId)) return;
    markSeen(role, conversationId);
  }, [conversationId, role]);

  useEffect(() => {
    if (!isNonEmptyString(conversationId)) return;

    const cid = conversationId; // cid is now *definitely* string
    let cancelled = false;

    async function loadMessages() {
      try {
        const res = await fetch(`/api/chat/${encodeURIComponent(cid)}`, {
          method: "GET",
          cache: "no-store",
        });

        const data = await res.json().catch(() => null);

        if (!res.ok || !data?.ok) {
          if (!cancelled) setError(data?.error || "Could not load chat.");
          return;
        }

        if (!cancelled) {
          setMessages((data.messages || []) as ChatMessage[]);
          setError(null);
          markSeen(role, cid);
        }
      } catch {
        if (!cancelled) setError("Network error while loading chat.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setHadFirstLoad(true);
        }
      }
    }

    loadMessages();

    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(loadMessages, 5000);

    return () => {
      cancelled = true;
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [conversationId, role]);

  useEffect(() => {
    if (!hadFirstLoad) return;
    if (!prefill) return;
    if (messages.length > 0) return;
    if (!(isEmbedded && role === "driver")) return;
    setInput(prefill);
  }, [hadFirstLoad, prefill, messages.length, isEmbedded, role]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;

    const text = input.trim();
    if (!text) return;

    if (!isNonEmptyString(conversationId)) return;
    const cid = conversationId;

    setInput("");

    try {
      const res = await fetch(`/api/chat/${encodeURIComponent(cid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Could not send message.");
        return;
      }

      setMessages((prev) => [...prev, data.message as ChatMessage]);
      setError(null);

      markSeen(role, cid);

      if (isEmbedded && role === "driver" && autoClose) {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: "ridechat:close" }, "*");
        }
      }
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
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>Ride chat</h1>

      <div style={{ marginBottom: 24 }}>
        {loading ? (
          <p style={{ color: "#6b7280" }}>Loading chat…</p>
        ) : error ? (
          <p style={{ color: "#b91c1c" }}>{error}</p>
        ) : messages.length === 0 ? (
          <p style={{ color: "#6b7280" }}>No messages yet.</p>
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
                    gap: 12,
                  }}
                >
                  <span>{m.sender.publicId || m.sender.name || "User"}</span>
                  <span style={{ color: "#9ca3af" }}>{new Date(m.createdAt).toLocaleTimeString()}</span>
                </div>
                <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{m.body}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canSend ? (
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
      ) : (
        <p
          style={{
            fontSize: 12,
            color: "#6b7280",
            borderTop: "1px solid #e5e7eb",
            paddingTop: 16,
          }}
        >
          This chat is read-only.
        </p>
      )}
    </main>
  );
}