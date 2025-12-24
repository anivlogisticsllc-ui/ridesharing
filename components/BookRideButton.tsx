// components/BookRideButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Role = "RIDER" | "DRIVER" | undefined;

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

      // Redirect driver to portal and let portal open the chat
      if (data.conversationId) {
        router.push(
          `/driver/portal?conversationId=${encodeURIComponent(
            data.conversationId
          )}&autoOpenChat=1`
        );
      } else {
        // No chat created (should be rare) – fall back to portal
        router.push("/driver/portal");
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
    </div>
  );
}
