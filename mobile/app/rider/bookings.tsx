// mobile/app/rider/bookings.tsx

import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import DateField from "../../components/DateField";
import { apiRequest } from "../../services/api";
import { getAuthToken } from "../../services/auth";
import type {
  RiderBooking,
  RiderBookingsResponse,
} from "../../types/rider";

type FilterKey =
  | "ALL"
  | "ACTIVE"
  | "UPCOMING"
  | "COMPLETED"
  | "CANCELLED";

type DateFilter = "LAST_7" | "LAST_30" | "ALL" | "CUSTOM";

function safeDate(value?: string | null): Date | null {
  if (!value) return null;

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value: string) {
  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return "Unknown date";
  }

  return d.toLocaleString();
}

function formatMoney(cents?: number | null) {
  if (typeof cents !== "number") {
    return null;
  }

  return `$${(cents / 100).toFixed(2)}`;
}

function getFareCents(booking: RiderBooking): number | null {
  return (
    booking.effectiveTotalPriceCents ??
    booking.totalPriceCents ??
    booking.baseTotalPriceCents ??
    null
  );
}

function isCompletedRide(booking: RiderBooking) {
  return (
    booking.status === "COMPLETED" ||
    booking.rideStatus === "COMPLETED"
  );
}

function isCancelledLike(booking: RiderBooking) {
  return booking.status === "CANCELLED" || booking.status === "EXPIRED";
}

function isActiveRide(booking: RiderBooking) {
  return booking.rideStatus === "IN_ROUTE";
}

function isUpcomingRide(booking: RiderBooking) {
  return (
    !isCompletedRide(booking) &&
    !isCancelledLike(booking) &&
    !isActiveRide(booking)
  );
}

function getStatusColor(status: string) {
  if (status === "COMPLETED") {
    return {
      bg: "#ecfdf5",
      text: "#166534",
      border: "#bbf7d0",
    };
  }

  if (status === "IN_ROUTE") {
    return {
      bg: "#eff6ff",
      text: "#1d4ed8",
      border: "#bfdbfe",
    };
  }

  if (status === "CANCELLED" || status === "EXPIRED") {
    return {
      bg: "#fef2f2",
      text: "#b91c1c",
      border: "#fecaca",
    };
  }

  if (status === "OPEN" || status === "PENDING") {
    return {
      bg: "#fffbeb",
      text: "#92400e",
      border: "#fde68a",
    };
  }

  return {
    bg: "#f9fafb",
    text: "#374151",
    border: "#e5e7eb",
  };
}

export default function RiderBookingsScreen() {
  const router = useRouter();

  const [bookings, setBookings] = useState<RiderBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeFilter, setActiveFilter] =
    useState<FilterKey>("ALL");

  // "All" should really mean all rides by default.
  const [allDateFilter, setAllDateFilter] =
    useState<DateFilter>("ALL");

  // Match the web completed-history default.
  const [completedDateFilter, setCompletedDateFilter] =
    useState<DateFilter>("LAST_30");

  const [searchText, setSearchText] = useState("");

  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [customFromDraft, setCustomFromDraft] = useState("");
  const [customToDraft, setCustomToDraft] = useState("");

  async function loadBookings(opts?: { silent?: boolean; showRefreshing?: boolean }) {
    try {
      if (opts?.showRefreshing) {
        setRefreshing(true);
      }

      if (!opts?.silent) {
        setLoading(true);
      }

      setError(null);

      const token = await getAuthToken();

      const data = await apiRequest<RiderBookingsResponse>(
        "/api/mobile/rider/bookings",
        { token }
      );

      if (!data.ok) {
        setError(data.error || "Failed to load bookings.");
        return;
      }

      setBookings(data.bookings);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load bookings."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadBookings();

    const intervalId = setInterval(() => {
      void loadBookings({ silent: true });
    }, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  const activeRides = useMemo(
    () => bookings.filter(isActiveRide),
    [bookings]
  );

  const upcomingRides = useMemo(
    () => bookings.filter(isUpcomingRide),
    [bookings]
  );

  const completedRides = useMemo(
    () => bookings.filter(isCompletedRide),
    [bookings]
  );

  const cancelledRides = useMemo(
    () => bookings.filter(isCancelledLike),
    [bookings]
  );

  function matchesDateAndSearch(
    booking: RiderBooking,
    dateFilter: DateFilter
  ) {
    const now = new Date();

    const rideDate =
      safeDate(booking.tripCompletedAt) ||
      safeDate(booking.departureTime);

    if (rideDate) {
      if (dateFilter === "LAST_7") {
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - 7);

        if (rideDate < cutoff || rideDate > now) {
          return false;
        }
      }

      if (dateFilter === "LAST_30") {
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - 30);

        if (rideDate < cutoff || rideDate > now) {
          return false;
        }
      }

      if (dateFilter === "CUSTOM") {
        let from = customFrom ? new Date(customFrom) : null;
        let to = customTo ? new Date(customTo) : null;

        if (from && Number.isNaN(from.getTime())) {
          from = null;
        }

        if (to && Number.isNaN(to.getTime())) {
          to = null;
        }

        if (from && rideDate < from) {
          return false;
        }

        if (to) {
          const end = new Date(to);
          end.setHours(23, 59, 59, 999);

          if (rideDate > end) {
            return false;
          }
        }
      }
    }

    const query = searchText.trim().toLowerCase();

    if (query) {
      const searchable =
        `${booking.originCity} ${booking.destinationCity}`.toLowerCase();

      if (!searchable.includes(query)) {
        return false;
      }
    }

    return true;
  }

  const filteredAll = useMemo(
    () =>
      bookings.filter((booking) =>
        matchesDateAndSearch(booking, allDateFilter)
      ),
    [
      bookings,
      allDateFilter,
      searchText,
      customFrom,
      customTo,
    ]
  );

  const filteredCompleted = useMemo(
    () =>
      completedRides.filter((booking) =>
        matchesDateAndSearch(
          booking,
          completedDateFilter
        )
      ),
    [
      completedRides,
      completedDateFilter,
      searchText,
      customFrom,
      customTo,
    ]
  );

  const filteredBookings = useMemo(() => {
    if (activeFilter === "ACTIVE") {
      return activeRides;
    }

    if (activeFilter === "UPCOMING") {
      return upcomingRides;
    }

    if (activeFilter === "COMPLETED") {
      return filteredCompleted;
    }

    if (activeFilter === "CANCELLED") {
      return cancelledRides;
    }

    return filteredAll;
  }, [
    activeFilter,
    activeRides,
    upcomingRides,
    filteredCompleted,
    cancelledRides,
    filteredAll,
  ]);

  const completedStats = useMemo(() => {
    const ridesShown = filteredCompleted.length;

    const totalMiles = filteredCompleted.reduce(
      (sum, booking) => sum + (booking.distanceMiles ?? 0),
      0
    );

    const totalFareCents = filteredCompleted.reduce(
      (sum, booking) => sum + (getFareCents(booking) ?? 0),
      0
    );

    const averageMiles =
      ridesShown > 0 ? totalMiles / ridesShown : 0;

    return {
      ridesShown,
      totalMiles,
      totalFareCents,
      averageMiles,
    };
  }, [filteredCompleted]);

  function applyCustomRange() {
    setCustomFrom(customFromDraft);
    setCustomTo(customToDraft);
  }

  function clearCustomRange() {
    setCustomFrom("");
    setCustomTo("");

    setCustomFromDraft("");
    setCustomToDraft("");
  }

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
          Loading rides...
        </Text>
      </View>
    );
  }

  if (error) {
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
          Your rides
        </Text>

        <Text
          style={{
            color: "#b91c1c",
            marginBottom: 16,
          }}
        >
          {error}
        </Text>

        <Pressable
          onPress={() => loadBookings()}
          style={{
            backgroundColor: "#111827",
            padding: 14,
            borderRadius: 12,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: "#ffffff",
              fontWeight: "600",
            }}
          >
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 20,
        backgroundColor: "#f9fafb",
      }}
    >
      <View style={{ marginBottom: 16 }}>
        <Text
          style={{
            fontSize: 28,
            fontWeight: "600",
          }}
        >
          Your rides
        </Text>

        <Text
          style={{
            marginTop: 6,
            color: "#6b7280",
          }}
        >
          Track active trips and review completed rides.
        </Text>

        <Pressable
          onPress={() =>
            loadBookings({
              silent: true,
              showRefreshing: true,
            })
          }
          style={{
            marginTop: 14,
            alignSelf: "flex-start",
            borderWidth: 1,
            borderColor: "#d1d5db",
            backgroundColor: "#ffffff",
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderRadius: 999,
          }}
        >
          <Text
            style={{
              fontWeight: "500",
              color: "#111827",
            }}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </Text>
        </Pressable>
      </View>

      <SummaryRow
        active={activeRides.length}
        upcoming={upcomingRides.length}
        completed={completedRides.length}
        cancelled={cancelledRides.length}
      />

      <FilterTabs
        activeFilter={activeFilter}
        onChange={setActiveFilter}
        total={bookings.length}
        active={activeRides.length}
        upcoming={upcomingRides.length}
        completed={completedRides.length}
        cancelled={cancelledRides.length}
      />

      {(activeFilter === "ALL" ||
        activeFilter === "COMPLETED") && (
        <HistoryFilters
          dateFilter={
            activeFilter === "ALL"
              ? allDateFilter
              : completedDateFilter
          }
          setDateFilter={
            activeFilter === "ALL"
              ? setAllDateFilter
              : setCompletedDateFilter
          }
          searchText={searchText}
          setSearchText={setSearchText}
          customFromDraft={customFromDraft}
          setCustomFromDraft={setCustomFromDraft}
          customToDraft={customToDraft}
          setCustomToDraft={setCustomToDraft}
          applyCustomRange={applyCustomRange}
          clearCustomRange={clearCustomRange}
          showCompletedStats={
            activeFilter === "COMPLETED"
          }
          ridesShown={
            activeFilter === "ALL"
              ? filteredAll.length
              : completedStats.ridesShown
          }
          totalMiles={completedStats.totalMiles}
          totalFareCents={completedStats.totalFareCents}
          averageMiles={completedStats.averageMiles}
        />
      )}

      {filteredBookings.length === 0 ? (
        <Text
          style={{
            color: "#6b7280",
            marginTop: 18,
          }}
        >
          No rides found for this filter.
        </Text>
      ) : (
        <View style={{ marginTop: 16 }}>
          {filteredBookings.map((booking) => (
            <RideCard
              key={`${booking.rideId}-${booking.bookingId ?? booking.id}`}
              booking={booking}
              onPress={() =>
                router.push(
                  `/rider/trip/${booking.rideId}`
                )
              }
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function SummaryRow(props: {
  active: number;
  upcoming: number;
  completed: number;
  cancelled: number;
}) {
  const items = [
    { label: "Active", value: props.active },
    { label: "Upcoming", value: props.upcoming },
    { label: "Done", value: props.completed },
    { label: "Cancelled", value: props.cancelled },
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: 10,
        marginBottom: 16,
      }}
    >
      {items.map((item) => (
        <SummaryCard
          key={item.label}
          label={item.label}
          value={item.value}
        />
      ))}
    </ScrollView>
  );
}

function SummaryCard(props: {
  label: string;
  value: number;
}) {
  return (
    <View
      style={{
        width: 145,
        borderWidth: 1,
        borderColor: "#e5e7eb",
        borderRadius: 16,
        padding: 13,
        backgroundColor: "#ffffff",
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
          fontSize: 22,
          fontWeight: "600",
          marginTop: 4,
        }}
      >
        {props.value}
      </Text>
    </View>
  );
}

function FilterTabs(props: {
  activeFilter: FilterKey;
  onChange: (filter: FilterKey) => void;

  total: number;
  active: number;
  upcoming: number;
  completed: number;
  cancelled: number;
}) {
  const items: {
    key: FilterKey;
    label: string;
    count: number;
  }[] = [
    {
      key: "ALL",
      label: "All",
      count: props.total,
    },
    {
      key: "ACTIVE",
      label: "Active",
      count: props.active,
    },
    {
      key: "UPCOMING",
      label: "Upcoming",
      count: props.upcoming,
    },
    {
      key: "COMPLETED",
      label: "Completed",
      count: props.completed,
    },
    {
      key: "CANCELLED",
      label: "Cancelled",
      count: props.cancelled,
    },
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: 8,
      }}
    >
      {items.map((item) => {
        const active =
          props.activeFilter === item.key;

        return (
          <Pressable
            key={item.key}
            onPress={() =>
              props.onChange(item.key)
            }
            style={{
              borderWidth: 1,
              borderColor: active
                ? "#111827"
                : "#d1d5db",
              backgroundColor: active
                ? "#111827"
                : "#ffffff",
              borderRadius: 999,
              paddingVertical: 8,
              paddingHorizontal: 13,
            }}
          >
            <Text
              style={{
                color: active
                  ? "#ffffff"
                  : "#374151",
                fontWeight: "500",
              }}
            >
              {item.label} ({item.count})
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function HistoryFilters(props: {
  dateFilter: DateFilter;
  setDateFilter: (filter: DateFilter) => void;

  searchText: string;
  setSearchText: (value: string) => void;

  customFromDraft: string;
  setCustomFromDraft: (value: string) => void;

  customToDraft: string;
  setCustomToDraft: (value: string) => void;

  applyCustomRange: () => void;
  clearCustomRange: () => void;

  showCompletedStats: boolean;
  ridesShown: number;
  totalMiles: number;
  totalFareCents: number;
  averageMiles: number;
}) {
  return (
    <View style={{ marginTop: 16 }}>
      <TextInput
        value={props.searchText}
        onChangeText={props.setSearchText}
        placeholder="Search by address"
        autoCapitalize="none"
        style={{
          borderWidth: 1,
          borderColor: "#d1d5db",
          borderRadius: 12,
          paddingVertical: 10,
          paddingHorizontal: 12,
          backgroundColor: "#ffffff",
          marginBottom: 10,
        }}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: 8,
        }}
      >
        <DateFilterButton
          label="Last 7 days"
          active={props.dateFilter === "LAST_7"}
          onPress={() =>
            props.setDateFilter("LAST_7")
          }
        />

        <DateFilterButton
          label="Last 30 days"
          active={props.dateFilter === "LAST_30"}
          onPress={() =>
            props.setDateFilter("LAST_30")
          }
        />

        <DateFilterButton
          label="All time"
          active={props.dateFilter === "ALL"}
          onPress={() =>
            props.setDateFilter("ALL")
          }
        />

        <DateFilterButton
          label="Custom"
          active={props.dateFilter === "CUSTOM"}
          onPress={() =>
            props.setDateFilter("CUSTOM")
          }
        />
      </ScrollView>

      {props.dateFilter === "CUSTOM" ? (
        <View
          style={{
            marginTop: 10,
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
          }}
        >
          <DateField
            label="From"
            value={props.customFromDraft}
            onChange={props.setCustomFromDraft}
          />

          <DateField
            label="To"
            value={props.customToDraft}
            onChange={props.setCustomToDraft}
          />

          <Pressable
            onPress={props.applyCustomRange}
            style={{
              minHeight: 38,
              justifyContent: "center",
              backgroundColor: "#111827",
              borderRadius: 999,
              paddingHorizontal: 14,
            }}
          >
            <Text
              style={{
                color: "#ffffff",
                fontWeight: "500",
                fontSize: 13,
              }}
            >
              Apply
            </Text>
          </Pressable>

          <Pressable
            onPress={props.clearCustomRange}
            style={{
              minHeight: 38,
              justifyContent: "center",
              borderWidth: 1,
              borderColor: "#d1d5db",
              backgroundColor: "#ffffff",
              borderRadius: 999,
              paddingHorizontal: 14,
            }}
          >
            <Text
              style={{
                color: "#111827",
                fontSize: 13,
              }}
            >
              Clear
            </Text>
          </Pressable>
        </View>
      ) : null}

      {props.showCompletedStats ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: 8,
            marginTop: 12,
          }}
        >
          <MiniStat
            label="Rides shown"
            value={String(props.ridesShown)}
          />

          <MiniStat
            label="Total miles"
            value={props.totalMiles.toFixed(2)}
          />

          <MiniStat
            label="Total spent"
            value={`$${(
              props.totalFareCents / 100
            ).toFixed(2)}`}
          />

          <MiniStat
            label="Avg. miles / ride"
            value={props.averageMiles.toFixed(2)}
          />
        </ScrollView>
      ) : (
        <View style={{ marginTop: 12 }}>
          <MiniStat
            label="Rides shown"
            value={String(props.ridesShown)}
          />
        </View>
      )}
    </View>
  );
}

function DateFilterButton(props: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={{
        borderWidth: 1,
        borderColor: props.active
          ? "#111827"
          : "#d1d5db",
        backgroundColor: props.active
          ? "#111827"
          : "#ffffff",
        borderRadius: 999,
        paddingVertical: 7,
        paddingHorizontal: 12,
      }}
    >
      <Text
        style={{
          color: props.active
            ? "#ffffff"
            : "#374151",
          fontSize: 13,
          fontWeight: "500",
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function MiniStat(props: {
  label: string;
  value: string;
}) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: "#e5e7eb",
        backgroundColor: "#ffffff",
        borderRadius: 999,
        paddingVertical: 7,
        paddingHorizontal: 11,
        alignSelf: "flex-start",
      }}
    >
      <Text
        style={{
          fontSize: 12,
          color: "#6b7280",
        }}
      >
        {props.label}:{" "}

        <Text
          style={{
            color: "#111827",
            fontWeight: "600",
          }}
        >
          {props.value}
        </Text>
      </Text>
    </View>
  );
}

function RideCard(props: {
  booking: RiderBooking;
  onPress: () => void;
}) {
  const { booking, onPress } = props;

  const fare =
    formatMoney(
      getFareCents(booking)
    );

  const rideColor =
    getStatusColor(
      booking.rideStatus
    );

  const bookingColor =
    getStatusColor(
      String(booking.status)
    );

  const cancelled = isCancelledLike(booking);

  return (
    <Pressable
      onPress={onPress}
      style={{
        borderWidth: 1,
        borderColor: cancelled
          ? "#fecaca"
          : "#e5e7eb",
        borderRadius: 18,
        padding: 16,
        marginBottom: 12,
        backgroundColor: cancelled
          ? "#fff7f7"
          : "#ffffff",
      }}
    >
      <Text
        style={{
          fontSize: 16,
          fontWeight: "500",
          lineHeight: 22,
        }}
      >
        {booking.originCity}
      </Text>

      <Text
        style={{
          color: "#6b7280",
          marginVertical: 4,
        }}
      >
        ↓
      </Text>

      <Text
        style={{
          fontSize: 16,
          fontWeight: "500",
          lineHeight: 22,
        }}
      >
        {booking.destinationCity}
      </Text>

      <Text
        style={{
          marginTop: 10,
          color: "#4b5563",
        }}
      >
        {formatDate(
          booking.departureTime
        )}
      </Text>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 10,
        }}
      >
        <StatusBadge
          label={`Ride ${booking.rideStatus}`}
          colors={rideColor}
        />

        <StatusBadge
          label={`Booking ${booking.status}`}
          colors={bookingColor}
        />
      </View>

      {booking.driverName ? (
        <Text
          style={{
            marginTop: 10,
            color: "#4b5563",
          }}
        >
          Driver: {booking.driverName}
        </Text>
      ) : null}

      {fare ? (
        <Text
          style={{
            marginTop: 10,
            fontSize: 16,
            fontWeight: "600",
          }}
        >
          {fare}
        </Text>
      ) : null}

      <Text
        style={{
          marginTop: 12,
          color: "#2563eb",
          fontWeight: "600",
        }}
      >
        View trip details →
      </Text>
    </Pressable>
  );
}

function StatusBadge(props: {
  label: string;

  colors: {
    bg: string;
    text: string;
    border: string;
  };
}) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: props.colors.border,
        backgroundColor: props.colors.bg,
        borderRadius: 999,
        paddingVertical: 4,
        paddingHorizontal: 10,
      }}
    >
      <Text
        style={{
          color: props.colors.text,
          fontSize: 12,
          fontWeight: "600",
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}