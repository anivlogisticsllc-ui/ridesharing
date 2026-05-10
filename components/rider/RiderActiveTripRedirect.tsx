"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type RiderBookingLite = {
  rideId: string;
  bookingId: string | null;
  rideStatus: string;
  status: string;
  departureTime: string;
};

type RiderBookingsResponse =
  | { ok: true; bookings: RiderBookingLite[] }
  | { ok: false; error: string };

function safeTime(value: string | null | undefined): number {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function getBestRedirectRideId(bookings: RiderBookingLite[]): string | null {
  const candidates = bookings
    .filter(
      (b) =>
        !!b.rideId &&
        !!b.bookingId &&
        (b.rideStatus === "ACCEPTED" || b.rideStatus === "IN_ROUTE")
    )
    .sort((a, b) => {
      const aScore = a.rideStatus === "IN_ROUTE" ? 2 : 1;
      const bScore = b.rideStatus === "IN_ROUTE" ? 2 : 1;
      if (aScore !== bScore) return bScore - aScore;
      return safeTime(a.departureTime) - safeTime(b.departureTime);
    });

  return candidates[0]?.rideId ?? null;
}

export default function RiderActiveTripRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, status } = useSession();

  const previousAcceptedOrLiveRideIdsRef = useRef<string[]>([]);
  const hasMountedRef = useRef(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRider = useMemo(() => {
    const role = (session?.user as { role?: string } | undefined)?.role;
    return role === "RIDER";
  }, [session]);

  useEffect(() => {
    if (status !== "authenticated" || !isRider) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      previousAcceptedOrLiveRideIdsRef.current = [];
      hasMountedRef.current = false;
      return;
    }

    let cancelled = false;

    async function checkForRedirect() {
      try {
        const res = await fetch("/api/rider/bookings", {
          method: "GET",
          cache: "no-store",
        });

        if (!res.ok) return;

        const data = (await res.json()) as RiderBookingsResponse;
        if (!data.ok || cancelled) return;

        const currentAcceptedOrLiveIds = data.bookings
          .filter(
            (b) =>
              !!b.rideId &&
              !!b.bookingId &&
              (b.rideStatus === "ACCEPTED" || b.rideStatus === "IN_ROUTE")
          )
          .map((b) => b.rideId)
          .sort();

        const previousIds = previousAcceptedOrLiveRideIdsRef.current;

        if (!hasMountedRef.current) {
          hasMountedRef.current = true;
          previousAcceptedOrLiveRideIdsRef.current = currentAcceptedOrLiveIds;
          return;
        }

        const newlyActiveRideId = currentAcceptedOrLiveIds.find(
          (rideId) => !previousIds.includes(rideId)
        );

        if (!newlyActiveRideId) {
          previousAcceptedOrLiveRideIdsRef.current = currentAcceptedOrLiveIds;
          return;
        }

        const bestRideId = getBestRedirectRideId(data.bookings) ?? newlyActiveRideId;
        const targetPath = `/rider/trips/${encodeURIComponent(bestRideId)}`;

        if (pathname === targetPath) {
          previousAcceptedOrLiveRideIdsRef.current = currentAcceptedOrLiveIds;
          return;
        }

        const storageKey = `rider-trip-redirected:${bestRideId}`;
        const alreadyRedirected =
          typeof window !== "undefined" &&
          window.sessionStorage.getItem(storageKey) === "1";

        if (!alreadyRedirected) {
          window.sessionStorage.setItem(storageKey, "1");
          previousAcceptedOrLiveRideIdsRef.current = currentAcceptedOrLiveIds;
          router.push(targetPath);
          return;
        }

        previousAcceptedOrLiveRideIdsRef.current = currentAcceptedOrLiveIds;
      } catch (err) {
        console.error("RiderActiveTripRedirect error:", err);
      }
    }

    void checkForRedirect();

    pollingRef.current = setInterval(() => {
      void checkForRedirect();
    }, 5000);

    const handleFocus = () => {
      void checkForRedirect();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void checkForRedirect();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;

      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }

      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [status, isRider, router, pathname]);

  return null;
}