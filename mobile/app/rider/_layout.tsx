// mobile/app/rider/_layout.tsx

import { Stack, usePathname, useRouter } from "expo-router";
import { useEffect, useRef } from "react";

import { apiRequest } from "../../services/api";
import { getAuthToken } from "../../services/auth";

type RiderActivity = {
  rideId: string;
  bookingId: string | null;
  bookingStatus: string;
  rideStatus: string;
  conversationId: string | null;
  departureTime: string;
  tripStartedAt: string | null;
};

type RiderActivityResponse =
  | {
      ok: true;
      activeRide: RiderActivity | null;
    }
  | {
      ok: false;
      error: string;
    };

type ChatNotification = {
  conversationId: string;
  rideId: string | null;
  rideStatus: string | null;
  unreadCount: number;
  latestMessageId: string | null;
  latestMessageCreatedAt: string | null;
  latestMessageSenderId: string | null;
  senderType: "RIDER" | "DRIVER" | "UNKNOWN";
};

type ChatNotificationsResponse =
  | {
      ok: true;
      totalUnread: number;
      notifications: ChatNotification[];
    }
  | {
      ok: false;
      error: string;
    };

export default function RiderLayout() {
  const router = useRouter();
  const pathname = usePathname();

  const seenRideStateRef = useRef<Map<string, string>>(new Map());
  const seenMessageRef = useRef<Set<string>>(new Set());
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function checkRiderActivity() {
      if (busyRef.current) return;

      busyRef.current = true;

      try {
        const token = await getAuthToken();

        if (!token || cancelled) {
          return;
        }

        const [activityResult, notificationsResult] = await Promise.all([
          apiRequest<RiderActivityResponse>(
            "/api/mobile/rider/activity",
            { token }
          ),
          apiRequest<ChatNotificationsResponse>(
            "/api/mobile/rider/chat-notifications",
            { token }
          ),
        ]);

        if (cancelled) {
          return;
        }

        const isTripScreen = pathname.startsWith("/rider/trip/");
        const isChatScreen = pathname.startsWith("/rider/chat/");
        const isReceiptScreen = pathname.startsWith("/rider/receipt/");

        const canAutoNavigate =
          !isTripScreen &&
          !isChatScreen &&
          !isReceiptScreen;

        /*
         * Highest priority:
         * unread DRIVER message for an active ride.
         */
        if (canAutoNavigate && notificationsResult.ok) {
          const unreadDriverMessage =
            notificationsResult.notifications.find(
              (item) =>
                item.rideId &&
                (item.rideStatus === "ACCEPTED" ||
                  item.rideStatus === "IN_ROUTE") &&
                item.unreadCount > 0 &&
                item.senderType === "DRIVER" &&
                item.latestMessageId &&
                !seenMessageRef.current.has(item.latestMessageId)
            );

          if (
            unreadDriverMessage?.rideId &&
            unreadDriverMessage.latestMessageId
          ) {
            seenMessageRef.current.add(
              unreadDriverMessage.latestMessageId
            );

            router.replace(
              `/rider/trip/${encodeURIComponent(
                unreadDriverMessage.rideId
              )}`
            );

            return;
          }
        }

        if (!activityResult.ok) {
          return;
        }

        const activeRide = activityResult.activeRide;

        /*
         * No accepted or in-route ride.
         * Nothing to redirect to.
         */
        if (!activeRide) {
          return;
        }

        const currentState =
          `${activeRide.bookingStatus}:${activeRide.rideStatus}`;

        const previousState =
          seenRideStateRef.current.get(activeRide.rideId);

        /*
         * Remember the first state we see.
         *
         * If the rider is currently on a normal rider page,
         * redirect to the active trip.
         */
        if (!previousState) {
          seenRideStateRef.current.set(
            activeRide.rideId,
            currentState
          );

          if (canAutoNavigate) {
            router.replace(
              `/rider/trip/${encodeURIComponent(
                activeRide.rideId
              )}`
            );

            return;
          }

          return;
        }

        /*
         * Redirect when the active ride changes state,
         * for example ACCEPTED -> IN_ROUTE.
         */
        if (previousState !== currentState) {
          seenRideStateRef.current.set(
            activeRide.rideId,
            currentState
          );

          if (canAutoNavigate) {
            router.replace(
              `/rider/trip/${encodeURIComponent(
                activeRide.rideId
              )}`
            );

            return;
          }
        }
      } catch {
        /*
         * Global watcher must never block
         * normal rider navigation.
         */
      } finally {
        busyRef.current = false;
      }
    }

    void checkRiderActivity();

    const intervalId = setInterval(() => {
      void checkRiderActivity();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [pathname, router]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}