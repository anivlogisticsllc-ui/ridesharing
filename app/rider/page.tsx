// app/rider/page.tsx
"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type AddressSuggestion = {
  id: string;
  label: string;
  streetNumber: string;
  streetName: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
};

type DistanceEstimateResponse = {
  ok: boolean;
  distanceMiles?: number | null;
  error?: string;
};

type DepartureMode = "ASAP" | "SCHEDULED";
type PaymentChoice = "CARD" | "CASH";

type AddressFields = {
  streetNumber: string;
  streetName: string;
  city: string;
  state: string;
  zip: string;
  lat?: number;
  lng?: number;
};

type FormErrors = {
  pickup?: string;
  dropoff?: string;
  zipPickup?: string;
  zipDropoff?: string;
  passengerCount?: string;
  departureTime?: string;
};

const MIN_PASSENGERS = 1;
const MAX_PASSENGERS = 6;

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}

function buildDisplay(a: AddressFields) {
  return [
    a.streetNumber,
    a.streetName,
    a.city && `, ${a.city}`,
    a.state && `, ${a.state}`,
    a.zip && ` ${a.zip}`,
  ]
    .filter(Boolean)
    .join(" ");
}

function makeClientRequestId() {
  // Works in modern browsers; fallback for older
  const anyCrypto = globalThis.crypto as any;
  if (anyCrypto?.randomUUID) return anyCrypto.randomUUID();
  return `cr_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function RiderRequestFormHome() {
  const router = useRouter();

  const [departureMode, setDepartureMode] = useState<DepartureMode>("ASAP");
  const [departureTime, setDepartureTime] = useState<string>("");

  const [paymentType, setPaymentType] = useState<PaymentChoice>("CASH");

  const [pickup, setPickup] = useState<AddressFields>({
    streetNumber: "",
    streetName: "",
    city: "",
    state: "",
    zip: "",
  });

  const [dropoff, setDropoff] = useState<AddressFields>({
    streetNumber: "",
    streetName: "",
    city: "",
    state: "",
    zip: "",
  });

  const [passengerCount, setPassengerCount] = useState<number>(1);

  const [pickupQuery, setPickupQuery] = useState("");
  const [dropoffQuery, setDropoffQuery] = useState("");

  const [pickupSuggestions, setPickupSuggestions] = useState<AddressSuggestion[]>([]);
  const [dropoffSuggestions, setDropoffSuggestions] = useState<AddressSuggestion[]>([]);

  const [isEstimating, setIsEstimating] = useState(false);
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const debouncedPickupQuery = useDebouncedValue(pickupQuery, 250);
  const debouncedDropoffQuery = useDebouncedValue(dropoffQuery, 250);

  useEffect(() => {
    if (!debouncedPickupQuery.trim()) {
      setPickupSuggestions([]);
      return;
    }

    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(
          `/api/geo/suggest?q=${encodeURIComponent(debouncedPickupQuery)}&limit=5`,
          { signal: controller.signal }
        );
        if (!res.ok) return;
        const data: AddressSuggestion[] = await res.json();
        setPickupSuggestions(data);
      } catch (err) {
        if ((err as any).name !== "AbortError") console.error("Pickup suggest error:", err);
      }
    })();

    return () => controller.abort();
  }, [debouncedPickupQuery]);

  useEffect(() => {
    if (!debouncedDropoffQuery.trim()) {
      setDropoffSuggestions([]);
      return;
    }

    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(
          `/api/geo/suggest?q=${encodeURIComponent(debouncedDropoffQuery)}&limit=5`,
          { signal: controller.signal }
        );
        if (!res.ok) return;
        const data: AddressSuggestion[] = await res.json();
        setDropoffSuggestions(data);
      } catch (err) {
        if ((err as any).name !== "AbortError") console.error("Dropoff suggest error:", err);
      }
    })();

    return () => controller.abort();
  }, [debouncedDropoffQuery]);

  const pickupDisplay = useMemo(() => buildDisplay(pickup), [pickup]);
  const dropoffDisplay = useMemo(() => buildDisplay(dropoff), [dropoff]);

  function handleSelectPickup(s: AddressSuggestion) {
    setPickup({
      streetNumber: s.streetNumber,
      streetName: s.streetName,
      city: s.city,
      state: s.state,
      zip: s.zip,
      lat: s.lat,
      lng: s.lng,
    });
    setPickupQuery(s.label);
    setPickupSuggestions([]);
    setErrors((prev) => ({ ...prev, pickup: undefined, zipPickup: undefined }));
  }

  function handleSelectDropoff(s: AddressSuggestion) {
    setDropoff({
      streetNumber: s.streetNumber,
      streetName: s.streetName,
      city: s.city,
      state: s.state,
      zip: s.zip,
      lat: s.lat,
      lng: s.lng,
    });
    setDropoffQuery(s.label);
    setDropoffSuggestions([]);
    setErrors((prev) => ({ ...prev, dropoff: undefined, zipDropoff: undefined }));
  }

  function validate(): boolean {
    const next: FormErrors = {};

    const hasPickupBasic =
      pickup.streetNumber && pickup.streetName && pickup.city && pickup.state && pickup.zip;
    if (!hasPickupBasic) next.pickup = "Pickup address is required.";
    if (!/^\d{5}$/.test(pickup.zip.trim())) next.zipPickup = "Pickup ZIP must be 5 digits.";

    const hasDropoffBasic =
      dropoff.streetNumber && dropoff.streetName && dropoff.city && dropoff.state && dropoff.zip;
    if (!hasDropoffBasic) next.dropoff = "Dropoff address is required.";
    if (!/^\d{5}$/.test(dropoff.zip.trim())) next.zipDropoff = "Dropoff ZIP must be 5 digits.";

    if (
      !Number.isFinite(passengerCount) ||
      passengerCount < MIN_PASSENGERS ||
      passengerCount > MAX_PASSENGERS
    ) {
      next.passengerCount = `Passenger count must be between ${MIN_PASSENGERS} and ${MAX_PASSENGERS}.`;
    }

    if (departureMode === "SCHEDULED" && !departureTime) {
      next.departureTime = "Scheduled time is required.";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function estimateDistanceIfReady() {
    if (!pickup.lat || !pickup.lng || !dropoff.lat || !dropoff.lng) return;

    setIsEstimating(true);
    setEstimateError(null);
    setDistanceMiles(null);

    try {
      const res = await fetch("/api/geo/estimate-distance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          dropoffLat: dropoff.lat,
          dropoffLng: dropoff.lng,
        }),
      });

      const data: DistanceEstimateResponse = await res.json();

      if (!data.ok || !data.distanceMiles) {
        setEstimateError(data.error || "Could not estimate distance.");
        return;
      }

      setDistanceMiles(data.distanceMiles);
    } catch (err) {
      console.error("Estimate distance error:", err);
      setEstimateError("Failed to estimate distance.");
    } finally {
      setIsEstimating(false);
    }
  }

  useEffect(() => {
    estimateDistanceIfReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup.lat, pickup.lng, dropoff.lat, dropoff.lng]);

  const estimatedPrice = useMemo(() => {
    if (!distanceMiles || distanceMiles <= 0) return null;

    // Keep it aligned with API pricing: base $3 + $2/mile (ignore passenger multiplier for now)
    const baseFare = 3;
    const perMile = 2;
    const raw = baseFare + distanceMiles * perMile;

    // If CASH selected, show the discount preview (10% -> 1000 bps)
    const discounted = paymentType === "CASH" ? raw * 0.9 : raw;
    return Math.max(discounted, baseFare);
  }, [distanceMiles, paymentType]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validate()) return;

    if (!distanceMiles || distanceMiles <= 0) {
      setEstimateError("Distance estimate missing. Select both addresses.");
      return;
    }

    if (!pickup.lat || !pickup.lng || !dropoff.lat || !dropoff.lng) {
      setEstimateError("Missing coordinates. Pick from suggestions.");
      return;
    }

    setSubmitting(true);

    try {
      const dt =
        departureMode === "SCHEDULED"
          ? new Date(departureTime)
          : new Date();

      const res = await fetch("/api/rides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRequestId: makeClientRequestId(),
          originCity: pickupQuery || pickupDisplay,
          destinationCity: dropoffQuery || dropoffDisplay,
          originLat: pickup.lat,
          originLng: pickup.lng,
          destinationLat: dropoff.lat,
          destinationLng: dropoff.lng,
          departureTime: dt.toISOString(),
          passengerCount,
          distanceMiles,
          paymentType, // "CASH" | "CARD"
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        console.error("Create ride error:", data);
        alert(data?.error || "Something went wrong requesting your ride.");
        return;
      }

      const rideId = data.ride?.id;
      router.push(rideId ? `/rider/portal?highlight=${rideId}` : "/rider/portal");
    } catch (err) {
      console.error("Create ride exception:", err);
      alert("Unexpected error booking ride.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto max-w-xl space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    >
      <h1 className="text-xl font-semibold">Request a ride</h1>

      {/* Payment */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Payment</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPaymentType("CARD")}
            className={`flex-1 rounded border px-3 py-2 text-sm ${
              paymentType === "CARD" ? "border-black bg-black text-white" : "border-gray-300 bg-white"
            }`}
          >
            Card
          </button>
          <button
            type="button"
            onClick={() => setPaymentType("CASH")}
            className={`flex-1 rounded border px-3 py-2 text-sm ${
              paymentType === "CASH" ? "border-black bg-black text-white" : "border-gray-300 bg-white"
            }`}
          >
            Cash (10% off)
          </button>
        </div>
      </div>

      {/* Departure mode */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          When do you want to leave?
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDepartureMode("ASAP")}
            className={`flex-1 rounded border px-3 py-2 text-sm ${
              departureMode === "ASAP" ? "border-black bg-black text-white" : "border-gray-300 bg-white"
            }`}
          >
            As soon as possible
          </button>
          <button
            type="button"
            onClick={() => setDepartureMode("SCHEDULED")}
            className={`flex-1 rounded border px-3 py-2 text-sm ${
              departureMode === "SCHEDULED" ? "border-black bg-black text-white" : "border-gray-300 bg-white"
            }`}
          >
            Schedule
          </button>
        </div>

        {departureMode === "SCHEDULED" && (
          <div className="mt-2">
            <input
              type="datetime-local"
              value={departureTime}
              onChange={(e) => {
                setDepartureTime(e.target.value);
                setErrors((prev) => ({ ...prev, departureTime: undefined }));
              }}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
            {errors.departureTime && (
              <p className="mt-1 text-xs text-red-600">{errors.departureTime}</p>
            )}
          </div>
        )}
      </div>

      {/* Pickup */}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">Pickup</label>
        <input
          type="text"
          placeholder="Start typing your pickup address"
          value={pickupQuery}
          onChange={(e) => setPickupQuery(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
        {pickupDisplay && <p className="text-xs text-gray-500">Selected: {pickupDisplay}</p>}
        {errors.pickup && <p className="mt-1 text-xs text-red-600">{errors.pickup}</p>}
        {errors.zipPickup && <p className="mt-1 text-xs text-red-600">{errors.zipPickup}</p>}

        {pickupSuggestions.length > 0 && (
          <ul className="mt-1 max-h-48 overflow-y-auto rounded border border-gray-200 bg-white text-sm shadow">
            {pickupSuggestions.map((s) => (
              <li
                key={s.id}
                className="cursor-pointer px-3 py-2 hover:bg-gray-50"
                onClick={() => handleSelectPickup(s)}
              >
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Dropoff */}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">Destination</label>
        <input
          type="text"
          placeholder="Start typing your destination"
          value={dropoffQuery}
          onChange={(e) => setDropoffQuery(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
        {dropoffDisplay && <p className="text-xs text-gray-500">Selected: {dropoffDisplay}</p>}
        {errors.dropoff && <p className="mt-1 text-xs text-red-600">{errors.dropoff}</p>}
        {errors.zipDropoff && <p className="mt-1 text-xs text-red-600">{errors.zipDropoff}</p>}

        {dropoffSuggestions.length > 0 && (
          <ul className="mt-1 max-h-48 overflow-y-auto rounded border border-gray-200 bg-white text-sm shadow">
            {dropoffSuggestions.map((s) => (
              <li
                key={s.id}
                className="cursor-pointer px-3 py-2 hover:bg-gray-50"
                onClick={() => handleSelectDropoff(s)}
              >
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Passengers */}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">Passengers</label>
        <input
          type="number"
          min={MIN_PASSENGERS}
          max={MAX_PASSENGERS}
          value={passengerCount}
          onChange={(e) => setPassengerCount(Number(e.target.value) || MIN_PASSENGERS)}
          className="w-24 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        {errors.passengerCount && (
          <p className="mt-1 text-xs text-red-600">{errors.passengerCount}</p>
        )}
      </div>

      {/* Estimate summary */}
      <div className="rounded bg-gray-50 p-3 text-sm">
        <p className="font-medium">Estimated trip</p>
        {isEstimating && <p className="text-gray-500">Calculating…</p>}
        {!isEstimating && distanceMiles && (
          <>
            <p>Distance: {distanceMiles.toFixed(2)} miles</p>
            {estimatedPrice != null && <p>Estimated price: ${estimatedPrice.toFixed(2)}</p>}
          </>
        )}
        {estimateError && <p className="mt-1 text-xs text-red-600">{estimateError}</p>}
        {!isEstimating && !distanceMiles && !estimateError && (
          <p className="text-gray-500">Select both pickup and destination to see an estimate.</p>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {submitting ? "Requesting your ride…" : "Request ride"}
      </button>
    </form>
  );
}

export default RiderRequestFormHome;
