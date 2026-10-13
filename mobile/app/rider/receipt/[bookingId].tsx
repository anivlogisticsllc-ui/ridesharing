// mobile/app/rider/receipt/[bookingId].tsx

import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { apiRequest } from "../../../services/api";
import { getAuthToken } from "../../../services/auth";

type ReceiptResponse =
  | {
      ok: true;
      receipt: {
        booking: {
          id: string;
          status: string;
          createdAt: string;
          paymentType: "CARD" | "CASH" | null;
          originalPaymentType: "CARD" | "CASH" | null;
          displayedPaymentLabel: string | null;
          cashDiscountBps: number;
          originalCashDiscountBps: number;
          currency: string;
          riderName: string | null;
          riderEmail: string | null;
        };
        ride: {
          id: string;
          status: string;
          originCity: string;
          destinationCity: string;
          departureTime: string;
          tripStartedAt: string | null;
          tripCompletedAt: string | null;
          passengerCount: number | null;
          distanceMiles: number | null;
          driver: {
            id: string;
            name: string | null;
            email: string | null;
          } | null;
        };
        money: {
          baseFareCents: number;
          tipCents: number;
          discountCents: number;
          convenienceFeeCents: number;
          totalChargedCents: number;
        };
        payment: {
          id: string;
          status: string;
          paymentType: "CARD" | "CASH" | null;
          capturedAt: string | null;
          tipStatus: string | null;
          tipPercent: number | null;
          tipChargedAt: string | null;
          tipSkippedAt: string | null;
        } | null;
        cashFallback: {
          cashNotPaidAt: string | null;
          cashNotPaidReason: string | null;
          cashNotPaidNote: string | null;
          cashDiscountRevokedAt: string | null;
          cashDiscountRevokedReason: string | null;
          fallbackCardChargedAt: string | null;
        } | null;
        flags: {
          fallbackCharged: boolean;
          originallyCash: boolean;
        };
      };
    }
  | {
      ok: false;
      error: string;
    };

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function dateTime(value?: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString();
}

export default function RiderReceiptScreen() {
  const router = useRouter();

  const params =
    useLocalSearchParams<{ bookingId?: string }>();

  const bookingId =
    typeof params.bookingId === "string"
      ? params.bookingId
      : "";

  const [data, setData] =
    useState<Extract<ReceiptResponse, { ok: true }>["receipt"] | null>(
      null
    );

  const [loading, setLoading] = useState(true);
  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    async function loadReceipt() {
      try {
        setLoading(true);
        setError(null);

        const token =
          await getAuthToken();

        const result =
          await apiRequest<ReceiptResponse>(
            `/api/mobile/receipt/${encodeURIComponent(
              bookingId
            )}`,
            { token }
          );

        if (!result.ok) {
          setError(
            result.error ||
              "Failed to load receipt."
          );
          return;
        }

        setData(result.receipt);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load receipt."
        );
      } finally {
        setLoading(false);
      }
    }

    if (bookingId) {
      void loadReceipt();
    }
  }, [bookingId]);

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
            marginTop: 10,
            color: "#6b7280",
          }}
        >
          Loading receipt...
        </Text>
      </View>
    );
  }

  if (error || !data) {
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
          }}
        >
          Ride receipt
        </Text>

        <Text
          style={{
            marginTop: 12,
            color: "#b91c1c",
          }}
        >
          {error || "Receipt not found."}
        </Text>

        <Pressable
          onPress={() => router.replace("/rider/bookings")}
          style={{ marginTop: 18 }}
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
      </View>
    );
  }

  const { booking, ride, money: amounts, payment, cashFallback } = data;

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
        style={{ marginBottom: 16 }}
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
        }}
      >
        Ride receipt
      </Text>

      <Text
        style={{
          marginTop: 5,
          color: "#6b7280",
        }}
      >
        Booking ID: {booking.id}
      </Text>

      <View
        style={{
          marginTop: 16,
          borderWidth: 1,
          borderColor: "#e5e7eb",
          borderRadius: 16,
          padding: 16,
          backgroundColor: "#ffffff",
        }}
      >
        <Text
          style={{
            fontSize: 17,
            fontWeight: "600",
          }}
        >
          {ride.originCity} → {ride.destinationCity}
        </Text>

        <Text
          style={{
            marginTop: 6,
            color: "#6b7280",
          }}
        >
          Completed: {dateTime(ride.tripCompletedAt)}
        </Text>
      </View>

      {data.flags.fallbackCharged ? (
        <View
          style={{
            marginTop: 14,
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
            Cash payment was reported unpaid
          </Text>

          <Text
            style={{
              marginTop: 5,
              color: "#92400e",
              lineHeight: 19,
            }}
          >
            The cash discount was revoked and the saved card was used for the final charge.
          </Text>

          {cashFallback?.fallbackCardChargedAt ? (
            <Text
              style={{
                marginTop: 5,
                color: "#92400e",
              }}
            >
              Card charged: {dateTime(cashFallback.fallbackCardChargedAt)}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View
        style={{
          marginTop: 14,
          borderWidth: 1,
          borderColor: "#e5e7eb",
          borderRadius: 16,
          padding: 16,
          backgroundColor: "#ffffff",
        }}
      >
        <ReceiptRow
          label="Payment"
          value={booking.displayedPaymentLabel ?? "—"}
        />

        <ReceiptRow
          label="Driver"
          value={ride.driver?.name ?? "—"}
        />

        <ReceiptRow
          label="Distance"
          value={
            typeof ride.distanceMiles === "number"
              ? `${ride.distanceMiles.toFixed(2)} miles`
              : "—"
          }
        />

        <ReceiptRow
          label="Passengers"
          value={String(ride.passengerCount ?? 1)}
        />
      </View>

      <View
        style={{
          marginTop: 14,
          borderWidth: 1,
          borderColor: "#e5e7eb",
          borderRadius: 16,
          padding: 16,
          backgroundColor: "#ffffff",
        }}
      >
        <MoneyRow
          label="Base fare"
          value={money(amounts.baseFareCents)}
        />

        <MoneyRow
          label="Tip"
          value={money(amounts.tipCents)}
        />

        <MoneyRow
          label="Discount"
          value={`-${money(amounts.discountCents)}`}
        />

        <MoneyRow
          label="Convenience fee"
          value={money(amounts.convenienceFeeCents)}
        />

        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: "#e5e7eb",
            marginTop: 10,
            paddingTop: 12,
          }}
        >
          <MoneyRow
            label="Total charged"
            value={money(amounts.totalChargedCents)}
            strong
          />
        </View>
      </View>

      {payment?.tipStatus ? (
        <Text
          style={{
            marginTop: 14,
            color: "#6b7280",
          }}
        >
          Tip status: {payment.tipStatus}
          {typeof payment.tipPercent === "number"
            ? ` · ${payment.tipPercent}%`
            : ""}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function ReceiptRow(props: {
  label: string;
  value: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 12,
        paddingVertical: 6,
      }}
    >
      <Text style={{ color: "#6b7280" }}>
        {props.label}
      </Text>

      <Text
        style={{
          color: "#111827",
          fontWeight: "500",
          textAlign: "right",
          flexShrink: 1,
        }}
      >
        {props.value}
      </Text>
    </View>
  );
}

function MoneyRow(props: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 12,
        paddingVertical: 6,
      }}
    >
      <Text
        style={{
          color: props.strong ? "#111827" : "#4b5563",
          fontWeight: props.strong ? "600" : "400",
        }}
      >
        {props.label}
      </Text>

      <Text
        style={{
          color: "#111827",
          fontWeight: props.strong ? "700" : "500",
        }}
      >
        {props.value}
      </Text>
    </View>
  );
}