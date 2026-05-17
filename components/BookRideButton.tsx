"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Role = "RIDER" | "DRIVER" | "ADMIN";

function asRole(v: unknown): Role | null {
  return v === "RIDER" || v === "DRIVER" || v === "ADMIN" ? v : null;
}

type BookRideResponse =
  | { ok: true; bookingId: string; conversationId: string | null }
  | { ok: false; error: string };

function isMembershipError(message: string) {
  const m = message.toLowerCase();
  return m.includes("membership") && (m.includes("expired") || m.includes("active"));
}

export function BookRideButton({ rideId }: { rideId: string }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [membershipBlocked, setMembershipBlocked] = useState(false);

  async function handleClick() {
    setError(null);
    setMembershipBlocked(false);

    if (status === "loading") return;

    if (!session) {
      router.push("/auth/login?callbackUrl=/");
      return;
    }

    const role = asRole((session.user as any)?.role);

    if (role !== "DRIVER" && role !== "ADMIN") {
      setError("Only drivers can book rides.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/book-ride", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rideId }),
      });

      if (res.status === 401) {
        router.push("/auth/login?callbackUrl=/");
        return;
      }

      const data = (await res.json().catch(() => null)) as BookRideResponse | null;

      if (!res.ok || !data?.ok) {
        const message = (data as any)?.error || "Booking failed.";

        if (isMembershipError(message)) {
          setMembershipBlocked(true);
          setError(message);
          return;
        }

        setError(message);
        return;
      }

      setSuccess(true);

      if (data.conversationId) {
        router.push(
          `/driver/portal?conversationId=${encodeURIComponent(
            data.conversationId
          )}&autoOpenChat=1`
        );
      } else {
        router.push("/driver/portal");
      }
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading || success}
        className="rounded-full bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {success ? "Booked" : loading ? "Booking..." : "Book ride"}
      </button>

      {membershipBlocked ? (
        <div className="max-w-[300px] rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-right text-xs text-rose-900">
          <p className="font-semibold">Membership is expired.</p>
          <p className="mt-1 text-[11px] opacity-90">
            Renew your membership to book this ride.
          </p>
          <button
            type="button"
            onClick={() => router.push("/billing/membership")}
            className="mt-2 rounded-full border border-current/20 bg-white/60 px-3 py-1 text-[11px] font-medium hover:bg-white"
          >
            Open Membership & Billing
          </button>
        </div>
      ) : error ? (
        <span className="max-w-[220px] text-right text-[10px] text-rose-600">
          {error}
        </span>
      ) : null}
    </div>
  );
}