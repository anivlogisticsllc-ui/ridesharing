// components/BookRideButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Role = "RIDER" | "DRIVER" | "BOTH" | undefined;

type BookRideResponse =
  | {
      ok: true;
      bookingId: string;
      conversationId: string | null;
    }
  | {
      ok: false;
      error: string;
    };

export function BookRideButton({ rideId }: { rideId: string }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When set, we show the chat overlay
  const [activeConversationId, setActiveConversationId] =
    useState<string | null>(null);

  async function handleClick() {
    setError(null);

    // Still resolving session → do nothing
    if (status === "loading") return;

    // Not logged in → send to login, then back to home (driver board)
    if (!session) {
      router.push("/auth/login?callbackUrl=/");
      return;
    }

    const role = (session.user as any)?.role as Role;

    // Riders cannot accept rides
    if (role === "RIDER") {
      setError("Only drivers can accept rider requests.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/book-ride", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rideId }),
      });

      // Session expired mid-click
      if (res.status === 401) {
        router.push("/auth/login?callbackUrl=/");
        return;
      }

      let data: BookRideResponse | null = null;
      try {
        data = (await res.json()) as BookRideResponse;
      } catch {
        throw new Error("Unexpected response from server.");
      }

      if (!res.ok || !data || !("ok" in data) || !data.ok) {
        throw new Error((data as any)?.error || "Booking failed.");
      }

      setSuccess(true);

      // Open chat overlay for this ride if we have a conversation
      if (data.conversationId) {
        setActiveConversationId(data.conversationId);
      } else {
        // No chat created (should be rare) – fall back to home or portal
        router.push("/");
      }
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading || success}
        className="rounded-full bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {success ? "Booked" : loading ? "Booking..." : "Book ride"}
      </button>

      {error && (
        <span className="max-w-[220px] text-right text-[10px] text-rose-600">
          {error}
        </span>
      )}

      {activeConversationId && (
        <ChatOverlay
          conversationId={activeConversationId}
          onClose={() => setActiveConversationId(null)}
        />
      )}
    </div>
  );
}

/**
 * Fullscreen overlay that embeds the /chat/[conversationId] page.
 * layout.tsx already hides the main header when ?embedded=1 is present.
 */
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
          <span style={{ fontWeight: 600 }}>Chat with rider</span>
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
          src={`/chat/${conversationId}?embedded=1`}
          style={{
            border: "none",
            width: "100%",
            height: "100%",
          }}
          title="Ride chat"
        />
      </div>
    </div>
  );
}
