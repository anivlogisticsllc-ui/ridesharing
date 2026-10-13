// mobile/app/rider/trip/[rideId].tsx

import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { apiRequest } from "../../../services/api";
import { getAuthToken } from "../../../services/auth";
import type {
  RiderBooking,
  RiderBookingsResponse,
} from "../../../types/rider";

type NotificationRow = {
  conversationId: string;
  unreadCount: number;
};

type NotificationResponse =
  | {
      ok: true;
      totalUnread: number;
      notifications: NotificationRow[];
    }
  | {
      ok: false;
      error: string;
    };

type TipActionResponse =
  | {
      ok: true;
      capturedAmountCents?: number;
      tipAmountCents?: number;
      totalAmountCents?: number;
    }
  | {
      ok: false;
      error: string;
      needsFallbackCharge?: boolean;
    };

function formatDate(value?: string | null) {
  if (!value) return "—";

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return "—";
  }

  return d.toLocaleString();
}

function formatMoney(cents?: number | null) {
  if (typeof cents !== "number") {
    return "—";
  }

  return `$${(cents / 100).toFixed(2)}`;
}

function formatDuration(ms: number) {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");

  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function getBaseFareCents(booking: RiderBooking): number | null {
  if (typeof booking.baseTotalPriceCents === "number") {
    return booking.baseTotalPriceCents;
  }

  if (typeof booking.totalPriceCents === "number") {
    return booking.totalPriceCents;
  }

  if (typeof booking.effectiveTotalPriceCents === "number") {
    return booking.effectiveTotalPriceCents;
  }

  return null;
}

function getEffectiveFareCents(booking: RiderBooking): number | null {
  if (typeof booking.effectiveTotalPriceCents === "number") {
    return booking.effectiveTotalPriceCents;
  }

  if (typeof booking.totalPriceCents === "number") {
    return booking.totalPriceCents;
  }

  if (typeof booking.baseTotalPriceCents === "number") {
    return booking.baseTotalPriceCents;
  }

  return null;
}

function buildTipOptions(baseFareCents: number) {
  return [10, 15, 20].map((percent) => ({
    percent,
    amountCents: Math.max(
      1,
      Math.round(baseFareCents * (percent / 100))
    ),
  }));
}

export default function RiderTripDetailsScreen() {
  const router = useRouter();

  const params =
    useLocalSearchParams<{ rideId?: string }>();

  const rideId =
    typeof params.rideId === "string"
      ? params.rideId
      : "";

  const [booking, setBooking] =
    useState<RiderBooking | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] =
    useState<string | null>(null);

  const [unreadCount, setUnreadCount] = useState(0);
  const [now, setNow] = useState(() => new Date());

  const [selectedTipPercent, setSelectedTipPercent] =
    useState<number | null>(null);

  const [tipSubmitting, setTipSubmitting] = useState(false);
  const [tipMessage, setTipMessage] =
    useState<string | null>(null);

  const [tipError, setTipError] =
    useState<string | null>(null);

  async function loadTrip(options?: { silent?: boolean }) {
    try {
      if (!options?.silent) {
        setLoading(true);
      }

      const token = await getAuthToken();

      const data = await apiRequest<RiderBookingsResponse>(
        "/api/mobile/rider/bookings",
        { token }
      );

      if (!data.ok) {
        if (!options?.silent) {
          setError(data.error || "Failed to load trip.");
        }
        return;
      }

      const found = data.bookings.find(
        (b) => b.rideId === rideId
      );

      if (!found) {
        if (!options?.silent) {
          setError("Trip not found.");
        }
        return;
      }

      setBooking(found);
      setError(null);
    } catch (err) {
      if (!options?.silent) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load trip."
        );
      }
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  async function loadUnread(conversationId: string) {
    try {
      const token = await getAuthToken();

      const data = await apiRequest<NotificationResponse>(
        "/api/mobile/rider/chat-notifications",
        { token }
      );

      if (!data.ok) {
        return;
      }

      const row = data.notifications.find(
        (item) =>
          item.conversationId === conversationId
      );

      setUnreadCount(row?.unreadCount ?? 0);
    } catch {
      // Unread state should never block trip details.
    }
  }

  useEffect(() => {
    void loadTrip();

    const id = setInterval(() => {
      void loadTrip({ silent: true });
    }, 5000);

    return () => clearInterval(id);
  }, [rideId]);

  useEffect(() => {
    const conversationId =
      booking?.conversationId;

    if (!conversationId) {
      setUnreadCount(0);
      return;
    }

    void loadUnread(conversationId);

    const id = setInterval(() => {
      void loadUnread(conversationId);
    }, 5000);

    return () => clearInterval(id);
  }, [booking?.conversationId]);

  useEffect(() => {
    if (booking?.rideStatus !== "IN_ROUTE") {
      return;
    }

    const id = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(id);
  }, [booking?.rideStatus]);

  const elapsedMs = useMemo(() => {
    if (!booking?.tripStartedAt) {
      return 0;
    }

    const started = new Date(
      booking.tripStartedAt
    );

    if (Number.isNaN(started.getTime())) {
      return 0;
    }

    if (
      booking.rideStatus === "COMPLETED" &&
      booking.tripCompletedAt
    ) {
      const completed =
        new Date(booking.tripCompletedAt);

      if (!Number.isNaN(completed.getTime())) {
        return Math.max(
          0,
          completed.getTime() - started.getTime()
        );
      }
    }

    if (booking.rideStatus === "IN_ROUTE") {
      return Math.max(
        0,
        now.getTime() - started.getTime()
      );
    }

    return 0;
  }, [
    booking?.tripStartedAt,
    booking?.tripCompletedAt,
    booking?.rideStatus,
    now,
  ]);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator />
        <Text
          style={{
            marginTop: 12,
            color: "#6b7280",
          }}
        >
          Loading trip...
        </Text>
      </View>
    );
  }

  if (error || !booking) {
    return (
      <View
        style={{
          flex: 1,
          padding: 24,
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            fontSize: 24,
            fontWeight: "600",
            marginBottom: 12,
          }}
        >
          Trip details
        </Text>

        <Text
          style={{
            color: "#b91c1c",
            marginBottom: 16,
          }}
        >
          {error || "Trip not found."}
        </Text>

        <Pressable
          onPress={() => router.replace("/rider/bookings")}
        >
          <Text
            style={{
              color: "#2563eb",
              fontWeight: "600",
            }}
          >
            Go back
          </Text>
        </Pressable>
      </View>
    );
  }

  const normalFare = getEffectiveFareCents(booking);

  const liveFare =
    booking.rideStatus === "IN_ROUTE"
      ? booking.totalPriceCents ?? normalFare
      : normalFare;

  const baseFareCents = getBaseFareCents(booking);

  const conversationId = booking.conversationId;
  const isLive = booking.rideStatus === "IN_ROUTE";
  const isCompleted = booking.rideStatus === "COMPLETED";

  const tipWindowExpired =
    Boolean(booking.tipEligibleUntil) &&
    new Date(booking.tipEligibleUntil as string).getTime() <
      Date.now();

  const tipEligible =
    isCompleted &&
    booking.paymentType === "CARD" &&
    booking.tipStatus === "ELIGIBLE" &&
    !tipWindowExpired &&
    typeof baseFareCents === "number" &&
    baseFareCents > 0;

  const tipOptions =
    typeof baseFareCents === "number" &&
    baseFareCents > 0
      ? buildTipOptions(baseFareCents)
      : [];

  const selectedTipAmountCents =
    selectedTipPercent != null
      ? tipOptions.find(
          (option) =>
            option.percent === selectedTipPercent
        )?.amountCents ?? 0
      : 0;

  const fallbackCharged = Boolean(
    booking.originalPaymentType === "CASH" &&
    booking.cashNotPaidAt &&
    booking.fallbackCardChargedAt
  );

  async function handleAddTip() {
    if (
      !selectedTipPercent ||
      !selectedTipAmountCents
    ) {
      return;
    }

    try {
      setTipSubmitting(true);
      setTipError(null);
      setTipMessage(null);

      const token = await getAuthToken();

      const result =
        await apiRequest<TipActionResponse>(
          "/api/mobile/rider/add-tip",
          {
            method: "POST",
            token,
            body: {
              rideId,
              tipAmountCents:
                selectedTipAmountCents,
              tipPercent:
                selectedTipPercent,
            },
          }
        );

      if (!result.ok) {
        setTipError(
          result.error ||
            "Failed to add tip."
        );
        return;
      }

      setTipMessage(
        `Tip added. Final total: ${formatMoney(
          result.totalAmountCents
        )}.`
      );

      setSelectedTipPercent(null);

      await loadTrip({
        silent: true,
      });
    } catch (err) {
      setTipError(
        err instanceof Error
          ? err.message
          : "Failed to add tip."
      );
    } finally {
      setTipSubmitting(false);
    }
  }

  async function handleSkipTip() {
    try {
      setTipSubmitting(true);
      setTipError(null);
      setTipMessage(null);

      const token = await getAuthToken();

      const result =
        await apiRequest<TipActionResponse>(
          "/api/mobile/rider/skip-tip",
          {
            method: "POST",
            token,
            body: {
              rideId,
            },
          }
        );

      if (!result.ok) {
        setTipError(
          result.error ||
            "Failed to skip tip."
        );
        return;
      }

      setTipMessage(
        "No tip added. Final payment captured."
      );

      setSelectedTipPercent(null);

      await loadTrip({
        silent: true,
      });
    } catch (err) {
      setTipError(
        err instanceof Error
          ? err.message
          : "Failed to skip tip."
      );
    } finally {
      setTipSubmitting(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 20,
        backgroundColor: "#f9fafb",
        paddingBottom: 32,
      }}
    >
      <Pressable
        onPress={() => router.replace("/rider/bookings")}
        style={{
          marginBottom: 16,
        }}
      >
        <Text
          style={{
            color: "#2563eb",
            fontWeight: "600",
          }}
        >
          ← Back
        </Text>
      </Pressable>

      <Text
        style={{
          fontSize: 28,
          fontWeight: "600",
          marginBottom: 8,
        }}
      >
        Trip details
      </Text>

      <Text
        style={{
          fontSize: 16,
          color: "#374151",
          marginBottom: 16,
          lineHeight: 22,
        }}
      >
        {booking.originCity} → {booking.destinationCity}
      </Text>

      {conversationId ? (
        <Pressable
          onPress={() =>
            router.push(
              `/rider/chat/${encodeURIComponent(
                conversationId
              )}?rideId=${encodeURIComponent(rideId)}`
            )
          }
          style={{
            alignSelf: "flex-start",
            marginBottom: 14,
            paddingVertical: 9,
            paddingHorizontal: 13,
            borderRadius: 12,
            backgroundColor:
              unreadCount > 0
                ? "#dc2626"
                : "#111827",
          }}
        >
          <Text
            style={{
              color: "#ffffff",
              fontWeight: "600",
            }}
          >
            {unreadCount > 0
              ? `Chat (${unreadCount} new)`
              : isCompleted
                ? "View chat"
                : "Chat with driver"}
          </Text>
        </Pressable>
      ) : null}

      {tipMessage ? (
        <Banner
          border="#a7f3d0"
          background="#ecfdf5"
          text="#065f46"
          message={tipMessage}
        />
      ) : null}

      {tipError ? (
        <Banner
          border="#fecaca"
          background="#fef2f2"
          text="#991b1b"
          message={tipError}
        />
      ) : null}

      {fallbackCharged ? (
        <View
          style={{
            marginBottom: 14,
            borderWidth: 1,
            borderColor: "#fde68a",
            borderRadius: 14,
            padding: 13,
            backgroundColor: "#fffbeb",
          }}
        >
          <Text
            style={{
              color: "#92400e",
              fontWeight: "600",
            }}
          >
            Cash payment reported unpaid
          </Text>

          <Text
            style={{
              color: "#92400e",
              marginTop: 5,
              lineHeight: 19,
            }}
          >
            The cash discount was revoked and your saved card was charged.
          </Text>
        </View>
      ) : null}

      {isLive ? (
        <View
          style={{
            marginBottom: 14,
            borderWidth: 1,
            borderColor: "#bbf7d0",
            borderRadius: 16,
            padding: 14,
            backgroundColor: "#f0fdf4",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <View>
              <Text
                style={{
                  color: "#166534",
                  fontWeight: "700",
                  fontSize: 15,
                }}
              >
                Meter running
              </Text>

              <Text
                style={{
                  color: "#4b5563",
                  marginTop: 3,
                  fontSize: 12,
                }}
              >
                Live values refresh from the driver meter.
              </Text>
            </View>

            <Text
              style={{
                fontSize: 22,
                fontWeight: "600",
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatDuration(elapsedMs)}
            </Text>
          </View>

          <View
            style={{
              flexDirection: "row",
              gap: 10,
              marginTop: 12,
            }}
          >
            <LiveValue
              label="Distance"
              value={
                typeof booking.distanceMiles === "number"
                  ? `${booking.distanceMiles.toFixed(2)} mi`
                  : "—"
              }
            />

            <LiveValue
              label="Estimated fare"
              value={formatMoney(liveFare)}
            />
          </View>

          {booking.paymentType === "CASH" ? (
            <Text
              style={{
                color: "#6b7280",
                marginTop: 10,
                fontSize: 12,
              }}
            >
              Cash discount applies at trip completion.
            </Text>
          ) : null}
        </View>
      ) : null}

      {isCompleted ? (
        <View
          style={{
            marginBottom: 14,
            borderWidth: 1,
            borderColor: "#cbd5e1",
            borderRadius: 16,
            padding: 14,
            backgroundColor: "#ffffff",
          }}
        >
          <Text
            style={{
              fontSize: 16,
              fontWeight: "600",
              color: "#111827",
            }}
          >
            Trip completed
          </Text>

          <Text
            style={{
              marginTop: 5,
              color: "#6b7280",
            }}
          >
            Completed {formatDate(booking.tripCompletedAt)}
          </Text>

          {booking.bookingId ? (
            <Pressable
              onPress={() =>
                router.push(
                  `/rider/receipt/${encodeURIComponent(
                    booking.bookingId as string
                  )}`
                )
              }
              style={{
                marginTop: 12,
                alignSelf: "flex-start",
                backgroundColor: "#111827",
                paddingVertical: 9,
                paddingHorizontal: 14,
                borderRadius: 12,
              }}
            >
              <Text
                style={{
                  color: "#ffffff",
                  fontWeight: "600",
                }}
              >
                View receipt
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {tipEligible ? (
        <View
          style={{
            marginBottom: 14,
            borderWidth: 1,
            borderColor: "#c7d2fe",
            borderRadius: 16,
            padding: 14,
            backgroundColor: "#eef2ff",
          }}
        >
          <Text
            style={{
              fontSize: 20,
              fontWeight: "700",
              color: "#312e81",
            }}
          >
            Add a tip
          </Text>

          <Text
            style={{
              marginTop: 5,
              color: "#4338ca",
            }}
          >
            Choose a tip before the final card capture.
          </Text>

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 14,
            }}
          >
            {tipOptions.map((option) => {
              const selected =
                selectedTipPercent === option.percent;

              return (
                <Pressable
                  key={option.percent}
                  onPress={() =>
                    setSelectedTipPercent(option.percent)
                  }
                  disabled={tipSubmitting}
                  style={{
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected
                      ? "#111827"
                      : "#cbd5e1",
                    backgroundColor: selected
                      ? "#111827"
                      : "#ffffff",
                    paddingVertical: 9,
                    paddingHorizontal: 13,
                    borderRadius: 999,
                  }}
                >
                  <Text
                    style={{
                      color: selected
                        ? "#ffffff"
                        : "#111827",
                      fontWeight: "600",
                    }}
                  >
                    {option.percent}% · {formatMoney(option.amountCents)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View
            style={{
              marginTop: 14,
              borderWidth: 1,
              borderColor: "#c7d2fe",
              borderRadius: 12,
              padding: 12,
              backgroundColor: "#ffffff",
            }}
          >
            <Text>
              Ride fare:{" "}
              <Text style={{ fontWeight: "600" }}>
                {formatMoney(baseFareCents)}
              </Text>
            </Text>

            {selectedTipAmountCents > 0 ? (
              <>
                <Text style={{ marginTop: 5 }}>
                  Tip:{" "}
                  <Text style={{ fontWeight: "600" }}>
                    {formatMoney(selectedTipAmountCents)}
                  </Text>
                </Text>

                <Text style={{ marginTop: 5 }}>
                  Total:{" "}
                  <Text style={{ fontWeight: "700" }}>
                    {formatMoney(
                      (baseFareCents ?? 0) +
                        selectedTipAmountCents
                    )}
                  </Text>
                </Text>
              </>
            ) : null}
          </View>

          <View
            style={{
              flexDirection: "row",
              gap: 8,
              marginTop: 12,
              flexWrap: "wrap",
            }}
          >
            <Pressable
              onPress={() => void handleAddTip()}
              disabled={
                tipSubmitting ||
                selectedTipAmountCents <= 0
              }
              style={{
                backgroundColor:
                  tipSubmitting ||
                  selectedTipAmountCents <= 0
                    ? "#a5b4fc"
                    : "#4f46e5",
                borderRadius: 12,
                paddingVertical: 11,
                paddingHorizontal: 15,
              }}
            >
              <Text
                style={{
                  color: "#ffffff",
                  fontWeight: "600",
                }}
              >
                {tipSubmitting
                  ? "Processing..."
                  : "Add tip"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => void handleSkipTip()}
              disabled={tipSubmitting}
              style={{
                borderWidth: 1,
                borderColor: "#cbd5e1",
                backgroundColor: "#ffffff",
                borderRadius: 12,
                paddingVertical: 11,
                paddingHorizontal: 15,
              }}
            >
              <Text
                style={{
                  color: "#111827",
                  fontWeight: "600",
                }}
              >
                Skip tip
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {isCompleted &&
      booking.paymentType === "CARD" &&
      booking.tipStatus === "ELIGIBLE" &&
      tipWindowExpired ? (
        <View
          style={{
            marginBottom: 14,
            borderWidth: 1,
            borderColor: "#e5e7eb",
            borderRadius: 14,
            padding: 12,
            backgroundColor: "#ffffff",
          }}
        >
          <Text style={{ color: "#6b7280" }}>
            The tip window has expired.
          </Text>

          <Pressable
            onPress={() => void handleSkipTip()}
            disabled={tipSubmitting}
            style={{
              marginTop: 10,
              alignSelf: "flex-start",
              backgroundColor: "#111827",
              borderRadius: 12,
              paddingVertical: 9,
              paddingHorizontal: 13,
            }}
          >
            <Text
              style={{
                color: "#ffffff",
                fontWeight: "600",
              }}
            >
              Finalize without tip
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <DetailRow
          label="Booking status"
          value={booking.status}
        />

        <DetailRow
          label="Ride status"
          value={booking.rideStatus}
        />

        <DetailRow
          label="Scheduled"
          value={formatDate(booking.departureTime)}
        />

        <DetailRow
          label="Started"
          value={formatDate(booking.tripStartedAt)}
        />

        <DetailRow
          label="Completed"
          value={formatDate(booking.tripCompletedAt)}
        />

        <DetailRow
          label="Driver"
          value={booking.driverName || "Not assigned"}
        />

        <DetailRow
          label={isLive ? "Current fare" : "Fare"}
          value={formatMoney(liveFare)}
        />

        <DetailRow
          label="Payment"
          value={
            fallbackCharged
              ? "CARD (fallback after unpaid CASH)"
              : booking.paymentType || "Not available"
          }
        />

        {fallbackCharged ? (
          <DetailRow
            label="Originally selected"
            value="CASH"
          />
        ) : null}

        {booking.tipStatus ? (
          <DetailRow
            label="Tip status"
            value={
              booking.tipPercent
                ? `${booking.tipStatus} · ${booking.tipPercent}%`
                : String(booking.tipStatus)
            }
          />
        ) : null}

        <DetailRow
          label="Distance"
          value={
            typeof booking.distanceMiles === "number"
              ? `${booking.distanceMiles.toFixed(2)} miles`
              : "—"
          }
        />

        <DetailRow
          label="Passengers"
          value={
            typeof booking.passengerCount === "number"
              ? String(booking.passengerCount)
              : "—"
          }
        />
      </View>
    </ScrollView>
  );
}

function Banner(props: {
  border: string;
  background: string;
  text: string;
  message: string;
}) {
  return (
    <View
      style={{
        marginBottom: 14,
        borderWidth: 1,
        borderColor: props.border,
        borderRadius: 12,
        padding: 12,
        backgroundColor: props.background,
      }}
    >
      <Text
        style={{
          color: props.text,
          fontWeight: "500",
        }}
      >
        {props.message}
      </Text>
    </View>
  );
}

function LiveValue(props: {
  label: string;
  value: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 12,
        padding: 10,
        backgroundColor: "#ffffff",
        borderWidth: 1,
        borderColor: "#dcfce7",
      }}
    >
      <Text
        style={{
          color: "#6b7280",
          fontSize: 12,
        }}
      >
        {props.label}
      </Text>

      <Text
        style={{
          marginTop: 3,
          fontSize: 16,
          fontWeight: "600",
          color: "#111827",
        }}
      >
        {props.value}
      </Text>
    </View>
  );
}

function DetailRow(props: {
  label: string;
  value: string;
}) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: "#e5e7eb",
        borderRadius: 14,
        padding: 14,
        backgroundColor: "#ffffff",
      }}
    >
      <Text
        style={{
          color: "#6b7280",
          fontSize: 13,
        }}
      >
        {props.label}
      </Text>

      <Text
        style={{
          marginTop: 4,
          fontSize: 16,
          fontWeight: "500",
        }}
      >
        {props.value}
      </Text>
    </View>
  );
}