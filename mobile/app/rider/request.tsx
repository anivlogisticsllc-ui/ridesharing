// mobile/app/rider/request.tsx

import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
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

type DepartureMode = "ASAP" | "SCHEDULED";
type PaymentType = "CARD" | "CASH";

type AddressSuggestion = {
  id: string;
  label: string;
  streetNumber: string;
  streetName: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
};

type SuggestResponse =
  | {
      ok: true;
      suggestions: AddressSuggestion[];
    }
  | {
      ok: false;
      error: string;
    };

type EstimateResponse =
  | {
      ok: true;
      miles: number;
      origin: {
        lat: number;
        lng: number;
      };
      destination: {
        lat: number;
        lng: number;
      };
    }
  | {
      ok: false;
      error: string;
    };

type PaymentMethodResponse =
  | {
      ok: true;
      hasPaymentMethod: boolean;
      card: {
        brand: string | null;
        last4: string | null;
        expMonth: number | null;
        expYear: number | null;
      } | null;
    }
  | {
      ok: false;
      error: string;
    };

type RideRequestResponse =
  | {
      ok: true;
      ride: {
        id: string;
      };
      booking?: {
        id: string;
      } | null;
    }
  | {
      ok: false;
      error: string;
    };

type EstimatedTrip = {
  miles: number;
  origin: {
    lat: number;
    lng: number;
  };
  destination: {
    lat: number;
    lng: number;
  };
};

function safeRequestId() {
  if (
    typeof globalThis.crypto !== "undefined" &&
    "randomUUID" in globalThis.crypto
  ) {
    return globalThis.crypto.randomUUID();
  }

  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function buildAddress(parts: {
  streetNumber: string;
  streetName: string;
  city: string;
  state: string;
  zip: string;
}) {
  const street = [parts.streetNumber.trim(), parts.streetName.trim()]
    .filter(Boolean)
    .join(" ");

  const cityState = [parts.city.trim(), parts.state.trim().toUpperCase()]
    .filter(Boolean)
    .join(", ");

  const zip = parts.zip.trim();

  if (!street || !cityState || !zip) {
    return "";
  }

  return `${street}, ${cityState} ${zip}`;
}

function formatFare(distanceMiles: number, paymentType: PaymentType) {
  const base = 3 + 2 * distanceMiles;
  const final = paymentType === "CASH" ? base * 0.9 : base;

  return {
    base,
    final,
  };
}

export default function RiderRequestScreen() {
  const router = useRouter();

  const [paymentType, setPaymentType] = useState<PaymentType>("CASH");
  const [departureMode, setDepartureMode] =
    useState<DepartureMode>("ASAP");

  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");

  const [originQuery, setOriginQuery] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");

  const [originSuggestions, setOriginSuggestions] =
    useState<AddressSuggestion[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] =
    useState<AddressSuggestion[]>([]);

  const [originStreetNumber, setOriginStreetNumber] = useState("");
  const [originStreetName, setOriginStreetName] = useState("");
  const [originCity, setOriginCity] = useState("");
  const [originState, setOriginState] = useState("");
  const [originZip, setOriginZip] = useState("");

  const [destinationStreetNumber, setDestinationStreetNumber] =
    useState("");
  const [destinationStreetName, setDestinationStreetName] =
    useState("");
  const [destinationCity, setDestinationCity] = useState("");
  const [destinationState, setDestinationState] = useState("");
  const [destinationZip, setDestinationZip] = useState("");

  const [passengerCount, setPassengerCount] = useState("1");

  const [estimatedTrip, setEstimatedTrip] =
    useState<EstimatedTrip | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkingCard, setCheckingCard] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [clientRequestId, setClientRequestId] =
    useState(() => safeRequestId());

  const originAddress = useMemo(
    () =>
      buildAddress({
        streetNumber: originStreetNumber,
        streetName: originStreetName,
        city: originCity,
        state: originState,
        zip: originZip,
      }),
    [
      originStreetNumber,
      originStreetName,
      originCity,
      originState,
      originZip,
    ]
  );

  const destinationAddress = useMemo(
    () =>
      buildAddress({
        streetNumber: destinationStreetNumber,
        streetName: destinationStreetName,
        city: destinationCity,
        state: destinationState,
        zip: destinationZip,
      }),
    [
      destinationStreetNumber,
      destinationStreetName,
      destinationCity,
      destinationState,
      destinationZip,
    ]
  );

  const fare = useMemo(
    () =>
      estimatedTrip
        ? formatFare(estimatedTrip.miles, paymentType)
        : null,
    [estimatedTrip, paymentType]
  );

  async function loadSuggestions(
    query: string,
    target: "ORIGIN" | "DESTINATION"
  ) {
    const trimmed = query.trim();

    if (trimmed.length < 3) {
      if (target === "ORIGIN") {
        setOriginSuggestions([]);
      } else {
        setDestinationSuggestions([]);
      }
      return;
    }

    try {
      const data = await apiRequest<SuggestResponse>(
        `/api/mobile/geo/suggest?q=${encodeURIComponent(trimmed)}`
      );

      if (!data.ok) {
        return;
      }

      if (target === "ORIGIN") {
        setOriginSuggestions(data.suggestions);
      } else {
        setDestinationSuggestions(data.suggestions);
      }
    } catch {
      // Suggestions are optional. Manual entry remains available.
    }
  }

  function applySuggestion(
    suggestion: AddressSuggestion,
    target: "ORIGIN" | "DESTINATION"
  ) {
    setError(null);

    if (target === "ORIGIN") {
      setOriginQuery(suggestion.label);
      setOriginStreetNumber(suggestion.streetNumber);
      setOriginStreetName(suggestion.streetName);
      setOriginCity(suggestion.city);
      setOriginState(suggestion.state);
      setOriginZip(suggestion.zip);
      setOriginSuggestions([]);
      return;
    }

    setDestinationQuery(suggestion.label);
    setDestinationStreetNumber(suggestion.streetNumber);
    setDestinationStreetName(suggestion.streetName);
    setDestinationCity(suggestion.city);
    setDestinationState(suggestion.state);
    setDestinationZip(suggestion.zip);
    setDestinationSuggestions([]);
  }

  async function estimateDistance(
    origin: string,
    destination: string
  ): Promise<EstimatedTrip | null> {
    try {
      setEstimating(true);

      const data = await apiRequest<EstimateResponse>(
        "/api/mobile/geo/estimate-distance",
        {
          method: "POST",
          body: {
            originAddress: origin,
            destinationAddress: destination,
          },
        }
      );

      if (!data.ok) {
        setEstimatedTrip(null);
        setError(data.error || "Could not estimate distance.");
        return null;
      }

      const trip: EstimatedTrip = {
        miles: data.miles,
        origin: data.origin,
        destination: data.destination,
      };

      setEstimatedTrip(trip);
      setError(null);

      return trip;
    } catch (err) {
      setEstimatedTrip(null);
      setError(
        err instanceof Error
          ? err.message
          : "Could not estimate distance."
      );
      return null;
    } finally {
      setEstimating(false);
    }
  }

  useEffect(() => {
    setEstimatedTrip(null);

    if (!originAddress || !destinationAddress) {
      return;
    }

    const timer = setTimeout(() => {
      void estimateDistance(originAddress, destinationAddress);
    }, 500);

    return () => clearTimeout(timer);
  }, [originAddress, destinationAddress]);

  async function checkCardOnFile() {
    try {
      setCheckingCard(true);

      const token = await getAuthToken();

      const data = await apiRequest<PaymentMethodResponse>(
        "/api/mobile/rider/payment-method-status",
        {
          token,
        }
      );

      if (!data.ok) {
        return {
          ok: false,
          error: data.error,
        };
      }

      if (!data.hasPaymentMethod) {
        return {
          ok: false,
          error: "A card is required before requesting a ride.",
        };
      }

      return {
        ok: true,
      };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Could not verify card on file.",
      };
    } finally {
      setCheckingCard(false);
    }
  }

  function buildDepartureTime() {
    if (departureMode === "ASAP") {
      return new Date().toISOString();
    }

    if (!scheduledDate || !scheduledTime) {
      return null;
    }

    const local = new Date(`${scheduledDate}T${scheduledTime}:00`);

    if (Number.isNaN(local.getTime())) {
      return null;
    }

    return local.toISOString();
  }

  async function submitRide() {
    try {
      setError(null);

      if (!originAddress || !destinationAddress) {
        setError("Please complete both addresses.");
        return;
      }

      if (
        !/^\d{5}$/.test(originZip.trim()) ||
        !/^\d{5}$/.test(destinationZip.trim())
      ) {
        setError("ZIP codes must be 5 digits.");
        return;
      }

      const passengers = Number(passengerCount);

      if (
        !Number.isFinite(passengers) ||
        passengers < 1 ||
        passengers > 6
      ) {
        setError("Passenger count must be between 1 and 6.");
        return;
      }

      const departureTime = buildDepartureTime();

      if (!departureTime) {
        setError("Please select a valid departure date and time.");
        return;
      }

      let trip = estimatedTrip;

      if (!trip) {
        trip = await estimateDistance(
          originAddress,
          destinationAddress
        );
      }

      if (!trip) {
        return;
      }

      const cardCheck = await checkCardOnFile();

      if (!cardCheck.ok) {
        setError(
          cardCheck.error ??
            "A card is required before requesting a ride."
        );
        return;
      }

      setSubmitting(true);

      const token = await getAuthToken();

      const data = await apiRequest<RideRequestResponse>(
        "/api/mobile/rider/request-ride",
        {
          method: "POST",
          token,
          body: {
            clientRequestId,
            originCity: originAddress,
            originLat: trip.origin.lat,
            originLng: trip.origin.lng,
            destinationCity: destinationAddress,
            destinationLat: trip.destination.lat,
            destinationLng: trip.destination.lng,
            departureTime,
            passengerCount: passengers,
            distanceMiles: trip.miles,
            paymentType,
          },
        }
      );

      if (!data.ok) {
        setError(data.error || "Failed to request ride.");
        return;
      }

      const rideId = data.ride?.id;

      if (!rideId) {
        setError("Ride was created but no ride ID was returned.");
        return;
      }

      setClientRequestId(safeRequestId());

      router.replace(`/rider/trip/${encodeURIComponent(rideId)}`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const requestDisabled =
    submitting ||
    estimating ||
    checkingCard ||
    !originAddress ||
    !destinationAddress ||
    !estimatedTrip;

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 18,
        paddingBottom: 30,
        backgroundColor: "#f9fafb",
      }}
    >
      <Pressable
        onPress={() => router.back()}
        style={{
          alignSelf: "flex-start",
          marginBottom: 14,
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
        }}
      >
        Request a ride
      </Text>

      <Text
        style={{
          marginTop: 5,
          color: "#6b7280",
          marginBottom: 16,
        }}
      >
        Enter your trip details and choose how you want to pay.
      </Text>

      <View
        style={{
          borderWidth: 1,
          borderColor: "#fde68a",
          backgroundColor: "#fffbeb",
          borderRadius: 14,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <Text
          style={{
            fontWeight: "600",
            color: "#92400e",
          }}
        >
          Cash rides
        </Text>

        <Text
          style={{
            color: "#92400e",
            marginTop: 3,
            lineHeight: 19,
          }}
        >
          Get 10% off when cash is paid in person. A card on file is
          still required.
        </Text>
      </View>

      <Section title="Payment">
        <SegmentedControl
          options={[
            {
              label: "Cash · 10% off",
              selected: paymentType === "CASH",
              onPress: () => setPaymentType("CASH"),
            },
            {
              label: "Card",
              selected: paymentType === "CARD",
              onPress: () => setPaymentType("CARD"),
            },
          ]}
        />
      </Section>

      <AddressSection
        title="From"
        query={originQuery}
        setQuery={(value) => {
          setOriginQuery(value);
          void loadSuggestions(value, "ORIGIN");
        }}
        suggestions={originSuggestions}
        applySuggestion={(s) => applySuggestion(s, "ORIGIN")}
        streetNumber={originStreetNumber}
        setStreetNumber={setOriginStreetNumber}
        streetName={originStreetName}
        setStreetName={setOriginStreetName}
        city={originCity}
        setCity={setOriginCity}
        state={originState}
        setState={setOriginState}
        zip={originZip}
        setZip={setOriginZip}
      />

      <AddressSection
        title="To"
        query={destinationQuery}
        setQuery={(value) => {
          setDestinationQuery(value);
          void loadSuggestions(value, "DESTINATION");
        }}
        suggestions={destinationSuggestions}
        applySuggestion={(s) => applySuggestion(s, "DESTINATION")}
        streetNumber={destinationStreetNumber}
        setStreetNumber={setDestinationStreetNumber}
        streetName={destinationStreetName}
        setStreetName={setDestinationStreetName}
        city={destinationCity}
        setCity={setDestinationCity}
        state={destinationState}
        setState={setDestinationState}
        zip={destinationZip}
        setZip={setDestinationZip}
      />

      <Section title="Departure">
        <SegmentedControl
          options={[
            {
              label: "ASAP",
              selected: departureMode === "ASAP",
              onPress: () => setDepartureMode("ASAP"),
            },
            {
              label: "Schedule",
              selected: departureMode === "SCHEDULED",
              onPress: () => setDepartureMode("SCHEDULED"),
            },
          ]}
        />

        {departureMode === "SCHEDULED" ? (
          <View
            style={{
              marginTop: 10,
              gap: 8,
            }}
          >
            <DateField
              label="Date"
              value={scheduledDate}
              onChange={setScheduledDate}
            />

            <TextInput
              value={scheduledTime}
              onChangeText={setScheduledTime}
              placeholder="Time, e.g. 14:30"
              keyboardType="numbers-and-punctuation"
              style={inputStyle}
            />

            <Text
              style={{
                color: "#6b7280",
                fontSize: 12,
              }}
            >
              Time is currently entered in 24-hour format.
            </Text>
          </View>
        ) : null}
      </Section>

      <Section title="Passengers">
        <TextInput
          value={passengerCount}
          onChangeText={setPassengerCount}
          placeholder="1"
          keyboardType="number-pad"
          style={inputStyle}
        />
      </Section>

      <TripSummary
        estimating={estimating}
        estimatedTrip={estimatedTrip}
        fare={fare}
        paymentType={paymentType}
      />

      {error ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: "#fecaca",
            backgroundColor: "#fef2f2",
            borderRadius: 12,
            padding: 12,
            marginBottom: 14,
          }}
        >
          <Text
            style={{
              color: "#b91c1c",
            }}
          >
            {error}
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => void submitRide()}
        disabled={requestDisabled}
        style={({ pressed }) => ({
          minHeight: 50,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: requestDisabled ? "#9ca3af" : "#111827",
          borderRadius: 16,
          paddingHorizontal: 18,
          opacity: pressed && !requestDisabled ? 0.88 : 1,
        })}
      >
        {submitting || checkingCard ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text
            style={{
              color: "#ffffff",
              fontWeight: "600",
              fontSize: 16,
            }}
          >
            Request ride
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: "#d1d5db",
  borderRadius: 12,
  paddingVertical: 10,
  paddingHorizontal: 12,
  backgroundColor: "#ffffff",
} as const;

function Section(props: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View
      style={{
        marginBottom: 15,
      }}
    >
      <Text
        style={{
          fontSize: 15,
          fontWeight: "600",
          marginBottom: 7,
          color: "#111827",
        }}
      >
        {props.title}
      </Text>

      {props.children}
    </View>
  );
}

function SegmentedControl(props: {
  options: Array<{
    label: string;
    selected: boolean;
    onPress: () => void;
  }>;
}) {
  return (
    <View
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        backgroundColor: "#e5e7eb",
        borderRadius: 12,
        padding: 3,
        gap: 3,
      }}
    >
      {props.options.map((option) => (
        <Pressable
          key={option.label}
          onPress={option.onPress}
          style={({ pressed }) => ({
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderRadius: 10,
            backgroundColor: option.selected ? "#111827" : "transparent",
            opacity: pressed ? 0.82 : 1,
          })}
        >
          <Text
            style={{
              color: option.selected ? "#ffffff" : "#374151",
              fontWeight: option.selected ? "600" : "500",
              fontSize: 13,
            }}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function TripSummary(props: {
  estimating: boolean;
  estimatedTrip: EstimatedTrip | null;
  fare: {
    base: number;
    final: number;
  } | null;
  paymentType: PaymentType;
}) {
  if (props.estimating) {
    return (
      <View
        style={{
          borderWidth: 1,
          borderColor: "#e5e7eb",
          borderRadius: 16,
          padding: 14,
          backgroundColor: "#ffffff",
          marginBottom: 15,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <ActivityIndicator />

        <Text
          style={{
            color: "#6b7280",
          }}
        >
          Calculating route and fare...
        </Text>
      </View>
    );
  }

  if (!props.estimatedTrip || !props.fare) {
    return (
      <View
        style={{
          borderWidth: 1,
          borderColor: "#e5e7eb",
          borderRadius: 16,
          padding: 14,
          backgroundColor: "#ffffff",
          marginBottom: 15,
        }}
      >
        <Text
          style={{
            color: "#6b7280",
          }}
        >
          Select complete From and To addresses to see the estimated
          distance and fare.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: "#d1d5db",
        borderRadius: 16,
        padding: 14,
        backgroundColor: "#ffffff",
        marginBottom: 15,
      }}
    >
      <Text
        style={{
          fontSize: 15,
          fontWeight: "600",
          color: "#111827",
        }}
      >
        Trip estimate
      </Text>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          marginTop: 10,
          gap: 8,
        }}
      >
        <EstimateItem
          label="Distance"
          value={`${props.estimatedTrip.miles.toFixed(1)} mi`}
        />

        <EstimateItem
          label="Standard"
          value={`$${props.fare.base.toFixed(2)}`}
        />

        <EstimateItem
          label={
            props.paymentType === "CASH"
              ? "Cash total"
              : "Estimated total"
          }
          value={`$${props.fare.final.toFixed(2)}`}
          strong
        />
      </View>
    </View>
  );
}

function EstimateItem(props: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View
      style={{
        minWidth: 105,
        borderRadius: 12,
        backgroundColor: "#f9fafb",
        paddingVertical: 9,
        paddingHorizontal: 11,
      }}
    >
      <Text
        style={{
          color: "#6b7280",
          fontSize: 11,
        }}
      >
        {props.label}
      </Text>

      <Text
        style={{
          marginTop: 2,
          color: "#111827",
          fontWeight: props.strong ? "700" : "600",
          fontSize: 15,
        }}
      >
        {props.value}
      </Text>
    </View>
  );
}

function AddressSection(props: {
  title: string;

  query: string;
  setQuery: (value: string) => void;

  suggestions: AddressSuggestion[];
  applySuggestion: (s: AddressSuggestion) => void;

  streetNumber: string;
  setStreetNumber: (value: string) => void;

  streetName: string;
  setStreetName: (value: string) => void;

  city: string;
  setCity: (value: string) => void;

  state: string;
  setState: (value: string) => void;

  zip: string;
  setZip: (value: string) => void;
}) {
  return (
    <Section title={`${props.title} address`}>
      <TextInput
        value={props.query}
        onChangeText={props.setQuery}
        placeholder={`Search ${props.title.toLowerCase()} address`}
        autoCapitalize="words"
        style={inputStyle}
      />

      {props.suggestions.length > 0 ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: "#e5e7eb",
            borderRadius: 12,
            backgroundColor: "#ffffff",
            marginTop: 4,
            overflow: "hidden",
          }}
        >
          {props.suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.id}
              onPress={() => props.applySuggestion(suggestion)}
              style={({ pressed }) => ({
                paddingVertical: 10,
                paddingHorizontal: 11,
                borderBottomWidth: 1,
                borderBottomColor: "#f3f4f6",
                backgroundColor: pressed ? "#f9fafb" : "#ffffff",
              })}
            >
              <Text
                style={{
                  color: "#374151",
                }}
              >
                {suggestion.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          gap: 8,
          marginTop: 8,
        }}
      >
        <TextInput
          value={props.streetNumber}
          onChangeText={props.setStreetNumber}
          placeholder="No."
          keyboardType="number-pad"
          style={[
            inputStyle,
            {
              width: 82,
            },
          ]}
        />

        <TextInput
          value={props.streetName}
          onChangeText={props.setStreetName}
          placeholder="Street"
          style={[
            inputStyle,
            {
              flex: 1,
            },
          ]}
        />
      </View>

      <TextInput
        value={props.city}
        onChangeText={props.setCity}
        placeholder="City"
        style={[
          inputStyle,
          {
            marginTop: 8,
          },
        ]}
      />

      <View
        style={{
          flexDirection: "row",
          gap: 8,
          marginTop: 8,
        }}
      >
        <TextInput
          value={props.state}
          onChangeText={(value) =>
            props.setState(value.toUpperCase().slice(0, 2))
          }
          placeholder="State"
          autoCapitalize="characters"
          maxLength={2}
          style={[
            inputStyle,
            {
              width: 82,
            },
          ]}
        />

        <TextInput
          value={props.zip}
          onChangeText={props.setZip}
          placeholder="ZIP"
          keyboardType="number-pad"
          maxLength={5}
          style={[
            inputStyle,
            {
              flex: 1,
            },
          ]}
        />
      </View>
    </Section>
  );
}